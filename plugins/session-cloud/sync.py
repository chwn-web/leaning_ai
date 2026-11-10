"""会话级云同步引擎 v0.1a（零第三方依赖，Python 3.11+）。

对应设计稿 plugins/session-cloud/DESIGN.md 的 §5/§6：
把某一条 harness 会话（字节原样）推到一个私有 git 仓库，或从仓库拉回本机。

用法：
  python sync.py config --remote <仓库路径或 URL> [--branch main]
  python sync.py status
  python sync.py mode --session <id> --to cloud|local
  python sync.py push  --session <id> [--all]
  python sync.py pull  --session <id> [--all]

仓库布局（远端）：
  sessions/<wsKey>/<sid>/session.v4.jsonl.zstd   会话数据，字节搬运
  index/<wsKey>/<sid>.json                       索引元数据（我们自己算的）

设计取舍（v0.1a 明确的边界）：
- 不解析会话内容（zstd 私有格式），只算 sha256、比对前缀；
- 附件暂不同步（v0.2），README 里写明；
- 跨机工作区路径不同时按 wsKey 原样落盘，cwd 改写留到 v0.2；
- 未闭合 turn 无法判断（不解析），因此 push 前要求会话文件在最近 N 秒内未修改。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
STATE_PATH = HERE / "state.json"
SESSION_FILE = "session.v4.jsonl.zstd"
# push 前要求会话文件静置这么久，避免把正在写的会话传上去
QUIET_SECONDS = 30


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


@dataclass
class Config:
    remote: str
    branch: str
    sessions_root: Path
    work: Path

    @staticmethod
    def load() -> "Config":
        raw = load_json(CONFIG_PATH, {})
        home = Path(os.path.expanduser("~"))
        return Config(
            remote=raw.get("remote", ""),
            branch=raw.get("branch", "main"),
            sessions_root=Path(raw.get("sessionsRoot", home / ".dsh" / "sessions")),
            work=Path(raw.get("work", str(HERE / ".work"))),
        )


def git(work: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    cmd = [
        "git", "-C", str(work),
        "-c", "user.name=dsh-session-cloud",
        "-c", "user.email=session-cloud@local",
        *args,
    ]
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", check=check)


def ensure_work(cfg: Config, use_git: bool = True) -> Path:
    """准备一个可提交的工作副本；远端是本地路径且不存在时顺手建 bare 仓库。

    use_git=False 时只把工作副本当普通目录用：用于在没有 git 通路的沙箱/离线环境里
    验证「打包 → 落位 → 拉回」这条字节链路，git 只作为传输层。
    """
    if not use_git:
        cfg.work.mkdir(parents=True, exist_ok=True)
        return cfg.work
    remote_path = Path(cfg.remote)
    if not cfg.remote:
        sys.exit("未配置远端：先跑 `python sync.py config --remote <路径或URL>`")
    is_local = "://" not in cfg.remote and not cfg.remote.startswith("git@")
    if is_local and not remote_path.exists():
        remote_path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "--bare", "-b", cfg.branch, str(remote_path)],
                       check=True, capture_output=True, text=True)
        print(f"已创建本地 bare 仓库：{remote_path}")
    if not (cfg.work / ".git").exists():
        cfg.work.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", cfg.remote, str(cfg.work)],
                       check=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
        print(f"已克隆到工作副本：{cfg.work}")
    return cfg.work


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def list_sessions(root: Path) -> list[tuple[str, str, Path]]:
    """返回 [(wsKey, sessionId, sessionDir)]。"""
    out: list[tuple[str, str, Path]] = []
    if not root.exists():
        return out
    for ws in sorted(p for p in root.iterdir() if p.is_dir()):
        for sid in sorted(p for p in ws.iterdir() if p.is_dir()):
            if (sid / SESSION_FILE).exists():
                out.append((ws.name, sid.name, sid))
    return out


def resolve(entries, wanted: str | None, all_flag: bool):
    if all_flag:
        return entries
    if not wanted:
        sys.exit("要么给 --session <id 前缀>，要么给 --all")
    # 目录名就是会话 id；但子代理会话的 id 不带 "session-" 前缀，用户习惯带上，所以两头都试。
    wanted = wanted.strip()
    bare = wanted.removeprefix("session-")
    hit = [
        e for e in entries
        if e[1] == wanted or e[1] == bare or e[1] == f"session-{bare}" or e[1].startswith(bare)
    ]
    if not hit:
        sys.exit(f"没有匹配的会话：{wanted}")
    if len(hit) > 1:
        sys.exit("前缀匹配到多条，请写长一点：\n" + "\n".join(f"  {e[1]}" for e in hit))
    return hit


def cmd_config(args) -> None:
    cfg = Config.load()
    data = load_json(CONFIG_PATH, {})
    if args.remote:
        data["remote"] = args.remote
    if args.branch:
        data["branch"] = args.branch
    if args.work:
        data["work"] = args.work
    if args.sessions_root:
        data["sessionsRoot"] = args.sessions_root
    save_json(CONFIG_PATH, data)
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_status(args) -> None:
    cfg = Config.load()
    mode_state = load_json(STATE_PATH, {})
    rows = []
    for ws, sid, d in list_sessions(cfg.sessions_root):
        f = d / SESSION_FILE
        st = f.stat()
        meta = {
            "workspace": ws,
            "session": sid,
            "size": st.st_size,
            "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime)),
            "mode": mode_state.get(sid, {}).get("mode", "local"),
            "syncedAt": mode_state.get(sid, {}).get("syncedAt", ""),
        }
        rows.append(meta)
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    if not rows:
        print(f"{cfg.sessions_root} 下没有会话")
        return
    print(f"远端：{cfg.remote or '(未配置)'}    分支：{cfg.branch}")
    for r in rows:
        tag = "☁ 云同步" if r["mode"] == "cloud" else "🖥 仅本机"
        print(f"  {r['session']}  {r['size'] / 1024:>8.1f}K  {r['modified']}  "
              f"同步于 {r['syncedAt'] or '-'}  {tag}")


def cmd_mode(args) -> None:
    cfg = Config.load()
    entries = resolve(list_sessions(cfg.sessions_root), args.session, False)
    ws, sid, _ = entries[0]
    state = load_json(STATE_PATH, {})
    rec = state.setdefault(sid, {})
    rec["mode"] = args.to
    rec["workspace"] = ws
    rec["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
    save_json(STATE_PATH, state)
    print(f"{sid} → {'☁ 云同步' if args.to == 'cloud' else '🖥 仅本机'}")


def cmd_push(args) -> None:
    cfg = Config.load()
    use_git = not args.no_git
    work = ensure_work(cfg, use_git)
    targets = resolve(list_sessions(cfg.sessions_root), args.session, args.all)
    if not targets:
        print("没有可推送的会话")
        return
    pushed = 0
    for ws, sid, d in targets:
        f = d / SESSION_FILE
        age = time.time() - f.stat().st_mtime
        if age < QUIET_SECONDS and not args.force:
            print(f"跳过 {sid}：会话 {int(age)}s 前还在写（{QUIET_SECONDS}s 内视为未闭合），--force 可强推")
            continue
        dst = work / "sessions" / ws / sid
        dst.mkdir(parents=True, exist_ok=True)
        for item in d.iterdir():
            if item.is_file():
                shutil.copy2(item, dst / item.name)
        digest = sha256_of(dst / SESSION_FILE)
        meta = {
            "workspace": ws,
            "session": sid,
            "sizeBytes": (dst / SESSION_FILE).stat().st_size,
            "sha256": digest,
            "pushedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "sourceMtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(f.stat().st_mtime)),
            "attachments": 0,
            "note": "v0.1a: 附件未同步",
        }
        save_json(work / "index" / ws / f"{sid}.json", meta)
        state = load_json(STATE_PATH, {})
        state.setdefault(sid, {})["mode"] = "cloud"
        state[sid]["syncedAt"] = meta["pushedAt"]
        state[sid]["sha256"] = digest
        save_json(STATE_PATH, state)
        print(f"已打包 {sid}（{meta['sizeBytes'] / 1024:.1f} KB, sha256 {digest[:12]}…）")
        pushed += 1
    if not pushed:
        return
    if not use_git:
        print(f"（--no-git）已写入本地工作副本：{work}，未提交、未推送")
        return
    git(work, "add", "-A")
    status = git(work, "status", "--porcelain").stdout.strip()
    if not status:
        print("远端已是最新，无需提交")
        return
    git(work, "commit", "-m", f"sync: {pushed} session(s) @ {time.strftime('%Y-%m-%d %H:%M:%S')}")
    git(work, "push", "origin", f"HEAD:{cfg.branch}")
    print(f"已推送到 {cfg.remote} ({cfg.branch})")


def cmd_pull(args) -> None:
    cfg = Config.load()
    use_git = not args.no_git
    work = ensure_work(cfg, use_git)
    if use_git:
        git(work, "fetch", "origin", cfg.branch, check=False)
        git(work, "checkout", cfg.branch, check=False)
        git(work, "reset", "--hard", f"origin/{cfg.branch}", check=False)
    root = work / "sessions"
    if not root.exists():
        print("远端没有会话")
        return
    wanted = set()
    if args.all:
        for idx in (work / "index").glob("*/*.json"):
            wanted.add(idx.stem)
    else:
        if not args.session:
            sys.exit("要么给 --session <id 前缀>，要么给 --all")
        for idx in (work / "index").glob("*/*.json"):
            if idx.stem.startswith(args.session):
                wanted.add(idx.stem)
        if not wanted:
            sys.exit(f"远端没有匹配的会话：{args.session}")
    pulled = 0
    for ws_dir in root.iterdir():
        if not ws_dir.is_dir():
            continue
        for s_dir in ws_dir.iterdir():
            if not s_dir.is_dir() or s_dir.name not in wanted:
                continue
            dst = cfg.sessions_root / ws_dir.name / s_dir.name
            dst.mkdir(parents=True, exist_ok=True)
            for item in s_dir.iterdir():
                if not item.is_file():
                    continue
                target = dst / item.name
                staging = target.with_name(target.name + ".part")
                shutil.copy2(item, staging)
                # 原子替换：DSH 的扫描器只认名为 session.v4.jsonl.zstd 的文件，
                # .part 中途不会被当成"半截会话"列出来。
                os.replace(staging, target)
            state = load_json(STATE_PATH, {})
            state.setdefault(s_dir.name, {})["mode"] = "cloud"
            state[s_dir.name]["pulledAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_json(STATE_PATH, state)
            print(f"已拉取 {s_dir.name} → {dst}")
            pulled += 1
    if not pulled:
        print("没有匹配到可拉取的会话")


def main() -> None:
    ap = argparse.ArgumentParser(description="会话级云同步引擎 v0.1a")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("config", help="配置远端")
    c.add_argument("--remote")
    c.add_argument("--branch")
    c.add_argument("--work")
    c.add_argument("--sessions-root")
    c.set_defaults(func=cmd_config)

    s = sub.add_parser("status", help="列出本机会话与模式")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_status)

    m = sub.add_parser("mode", help="设置某会话的存储模式")
    m.add_argument("--session", required=True)
    m.add_argument("--to", required=True, choices=["cloud", "local"])
    m.set_defaults(func=cmd_mode)

    p = sub.add_parser("push", help="上传会话到远端")
    p.add_argument("--session")
    p.add_argument("--all", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--no-git", action="store_true", help="只写入工作副本，不提交不推送（离线验字节链路用）")
    p.set_defaults(func=cmd_push)

    q = sub.add_parser("pull", help="从远端拉取会话")
    q.add_argument("--session")
    q.add_argument("--all", action="store_true")
    q.add_argument("--no-git", action="store_true", help="直接从工作副本读，不 fetch")
    q.set_defaults(func=cmd_pull)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
