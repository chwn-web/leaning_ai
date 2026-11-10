#!/usr/bin/env python3
"""sync.py 自测（零依赖，Python 3.11+）。

用法：
    python selftest.py            # 跑全部用例
    python selftest.py -v         # 打印每条命令的输出

设计原则：**不碰真实数据**。所有读写都通过环境变量引到 `.tmp-selftest/` 下：
    DSH_SESSION_CLOUD_REMOTE / SESSIONS_ROOT / WORK / STATE / CONFIG
真实会话目录 `~/.dsh/sessions` 与插件自己的 `state.json` 完全不参与。
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SYNC = HERE / "sync.py"
ROOT = HERE / ".tmp-selftest"
SESSION_FILE = "session.v4.jsonl.zstd"

VERBOSE = "-v" in sys.argv

results: list[tuple[str, bool, str]] = []


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))


class Sandbox:
    """一套隔离的远端/工作副本/sessions 根/状态文件。"""

    def __init__(self, name: str) -> None:
        self.dir = ROOT / name
        if self.dir.exists():
            shutil.rmtree(self.dir, ignore_errors=True)
        self.sessions = self.dir / "sessions"
        self.work = self.dir / "work"
        self.remote = self.dir / "remote.git"
        self.state = self.dir / "state.json"
        self.sessions.mkdir(parents=True, exist_ok=True)

    def env(self, **over) -> dict:
        env = dict(os.environ)
        env.update({
            "PYTHONIOENCODING": "utf-8",
            "DSH_SESSION_CLOUD_REMOTE": over.get("remote", str(self.remote)),
            "DSH_SESSION_CLOUD_SESSIONS_ROOT": over.get("sessions_root", str(self.sessions)),
            "DSH_SESSION_CLOUD_WORK": over.get("work", str(self.work)),
            "DSH_SESSION_CLOUD_STATE": over.get("state", str(self.state)),
            "DSH_SESSION_CLOUD_CONFIG": str(self.dir / "config.json"),
            "DSH_SESSION_CLOUD_BRANCH": "main",
        })
        return env

    def run(self, *args: str, **over) -> subprocess.CompletedProcess:
        cmd = [sys.executable, str(SYNC), *args]
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=self.env(**over))
        if VERBOSE:
            print(f"    $ sync.py {' '.join(args)}\n    rc={proc.returncode}\n    out={proc.stdout.strip()}\n    err={proc.stderr.strip()}")
        return proc

    def make_session(self, workspace: str, session: str, payload: bytes) -> Path:
        d = self.sessions / workspace / session
        d.mkdir(parents=True, exist_ok=True)
        f = d / SESSION_FILE
        f.write_bytes(payload)
        return f

    def wrote_index(self, workspace: str, session: str) -> dict | None:
        p = self.work / "index" / workspace / f"{session}.json"
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))


def t01_push_creates_remote() -> None:
    sb = Sandbox("t01")
    sb.make_session("--D-TEST--", "s1", b"hello-1" * 100)
    p = sb.run("push", "--all", "--force")
    idx = sb.wrote_index("--D-TEST--", "s1")
    check("T01 push 自动建 bare 仓库并打包", p.returncode == 0 and idx is not None,
          f"rc={p.returncode}, index={'有' if idx else '无'}")
    check("T01b index 记录 sha256 与源一致",
          idx is not None and idx["sha256"] == sha256_of(sb.sessions / "--D-TEST--" / "s1" / SESSION_FILE),
          "" if idx else "没有 index")


def t02_pull_roundtrip() -> None:
    sb = Sandbox("t02")
    payload = os.urandom(4096)
    sb.make_session("--D-TEST--", "s1", payload)
    sb.run("push", "--all", "--force")
    # 清空本地会话，模拟换机
    shutil.rmtree(sb.sessions)
    sb.sessions.mkdir(parents=True, exist_ok=True)
    p = sb.run("pull", "--all")
    dst = sb.sessions / "--D-TEST--" / "s1" / SESSION_FILE
    check("T02 pull 到空根目录能还原", p.returncode == 0 and dst.exists())
    check("T02b 还原后字节一致", dst.exists() and dst.read_bytes() == payload)


def t03_pull_idempotent() -> None:
    sb = Sandbox("t03")
    sb.make_session("--D-TEST--", "s1", b"abc" * 50)
    sb.run("push", "--all", "--force")
    sb.run("pull", "--all")
    before = sha256_of(sb.sessions / "--D-TEST--" / "s1" / SESSION_FILE)
    p = sb.run("pull", "--all")
    after = sha256_of(sb.sessions / "--D-TEST--" / "s1" / SESSION_FILE)
    parts = list((sb.sessions / "--D-TEST--" / "s1").glob("*.part"))
    check("T03 重复 pull 幂等且不留 .part", p.returncode == 0 and before == after and not parts,
          f"parts={[x.name for x in parts]}")


def t04_local_mode_skipped() -> None:
    sb = Sandbox("t04")
    sb.make_session("--D-TEST--", "s1", b"one" * 10)
    sb.make_session("--D-TEST--", "s2", b"two" * 10)
    sb.run("mode", "--session", "s1", "--to", "local")
    p = sb.run("push", "--all", "--force")
    skipped = sb.wrote_index("--D-TEST--", "s1") is None
    pushed_other = sb.wrote_index("--D-TEST--", "s2") is not None
    check("T04 「仅本机」在 push --all 里被跳过", p.returncode == 0 and skipped and pushed_other,
          "跳过提示: " + ("有" if "跳过 1 条" in p.stdout else "没有"))
    st = json.loads(sb.state.read_text(encoding="utf-8"))
    check("T04b push 不会把 mode 写回 cloud", st.get("s1", {}).get("mode") == "local",
          f"mode={st.get('s1', {}).get('mode')}")


def t05_include_local() -> None:
    sb = Sandbox("t05")
    sb.make_session("--D-TEST--", "s1", b"force-me" * 10)
    sb.run("mode", "--session", "s1", "--to", "local")
    p = sb.run("push", "--session", "s1", "--force", "--include-local")
    st = json.loads(sb.state.read_text(encoding="utf-8"))
    check("T05 --include-local 可点名强推", p.returncode == 0 and sb.wrote_index("--D-TEST--", "s1") is not None)
    check("T05b 强推后 mode 仍是 local", st.get("s1", {}).get("mode") == "local",
          f"mode={st.get('s1', {}).get('mode')}")


def t06_quiet_window() -> None:
    sb = Sandbox("t06")
    f = sb.make_session("--D-TEST--", "s1", b"writing" * 10)
    os.utime(f, None)  # mtime = now → 视为未闭合
    p1 = sb.run("push", "--all")
    skipped = sb.wrote_index("--D-TEST--", "s1") is None
    check("T06 未闭合会话（30s 内改过）默认跳过", skipped, p1.stdout.strip().splitlines()[0] if p1.stdout.strip() else "")
    p2 = sb.run("push", "--all", "--force")
    check("T06b --force 可以强推", sb.wrote_index("--D-TEST--", "s1") is not None)


def t07_unreachable_remote() -> None:
    sb = Sandbox("t07")
    sb.make_session("--D-TEST--", "s1", b"x" * 32)
    blocker = sb.dir / "not-a-repo.git"
    blocker.write_text("this is a file, not a repo", encoding="utf-8")
    p = sb.run("push", "--all", "--force", remote=str(blocker))
    no_traceback = "Traceback" not in (p.stdout + p.stderr)
    check("T07 远端不可用时给出可读错误（不吐 traceback）", p.returncode != 0 and no_traceback,
          (p.stderr or p.stdout).strip().splitlines()[-1][:80] if (p.stderr or p.stdout).strip() else "")


def t08_corrupt_state() -> None:
    sb = Sandbox("t08")
    sb.make_session("--D-TEST--", "s1", b"y" * 32)
    sb.state.write_text("{ this is not json", encoding="utf-8")
    p = sb.run("status")
    warned = "无法解析" in (p.stdout + p.stderr)
    check("T08 state.json 损坏时降级告警而不是崩", p.returncode == 0 and warned,
          f"rc={p.returncode}")


def t09_pull_missing() -> None:
    sb = Sandbox("t09")
    sb.make_session("--D-TEST--", "s1", b"z" * 32)
    sb.run("push", "--all", "--force")
    p = sb.run("pull", "--session", "does-not-exist")
    # 「远端没有这条会话」按错误处理（exit != 0），但必须是给人看的一句话，不是 traceback
    no_traceback = "Traceback" not in (p.stdout + p.stderr)
    check("T09 pull 不存在的会话给友好提示（非零退出、无 traceback）",
          p.returncode != 0 and no_traceback and "没有" in (p.stdout + p.stderr),
          (p.stdout + p.stderr).strip().splitlines()[-1] if (p.stdout + p.stderr).strip() else "")


def t10_mode_missing() -> None:
    sb = Sandbox("t10")
    p = sb.run("mode", "--session", "nope", "--to", "local")
    no_traceback = "Traceback" not in (p.stdout + p.stderr)
    check("T10 给不存在的会话设模式：友好报错且不吐 traceback",
          p.returncode != 0 and no_traceback, (p.stderr or p.stdout).strip().splitlines()[-1][:80])


def t11_overwrite_on_pull() -> None:
    sb = Sandbox("t11")
    session_dir = sb.sessions / "--D-TEST--" / "s1"
    sb.make_session("--D-TEST--", "s1", b"v1")
    sb.run("push", "--all", "--force")
    # 本机变成落后版本
    (session_dir / SESSION_FILE).write_bytes(b"stale-local-copy")
    p = sb.run("pull", "--all")
    check("T11 pull 会用云端覆盖本地旧副本",
          p.returncode == 0 and (session_dir / SESSION_FILE).read_bytes() == b"v1")


def t12_multi_workspace() -> None:
    sb = Sandbox("t12")
    sb.make_session("--D-TEST-A--", "s1", b"a" * 16)
    sb.make_session("--D-TEST-B--", "s1", b"b" * 16)  # 同名会话、不同工作区
    p = sb.run("push", "--all", "--force")
    both = (sb.wrote_index("--D-TEST-A--", "s1") is not None) and (sb.wrote_index("--D-TEST-B--", "s1") is not None)
    check("T12 同名会话在不同工作区互不覆盖", p.returncode == 0 and both)
    shutil.rmtree(sb.sessions)
    sb.sessions.mkdir(parents=True, exist_ok=True)
    sb.run("pull", "--all")
    a = (sb.sessions / "--D-TEST-A--" / "s1" / SESSION_FILE)
    b = (sb.sessions / "--D-TEST-B--" / "s1" / SESSION_FILE)
    check("T12b 拉回后两个工作区内容各自正确",
          a.exists() and b.exists() and a.read_bytes() == b"a" * 16 and b.read_bytes() == b"b" * 16)


def t13_large_file() -> None:
    sb = Sandbox("t13")
    payload = os.urandom(5 * 1024 * 1024)
    sb.make_session("--D-TEST--", "big", payload)
    t0 = time.time()
    p = sb.run("push", "--all", "--force")
    push_s = time.time() - t0
    shutil.rmtree(sb.sessions)
    sb.sessions.mkdir(parents=True, exist_ok=True)
    sb.run("pull", "--all")
    dst = sb.sessions / "--D-TEST--" / "big" / SESSION_FILE
    check("T13 5MB 会话往返字节一致", p.returncode == 0 and dst.exists() and sha256_of(dst) == hashlib.sha256(payload).hexdigest(),
          f"push 耗时 {push_s:.1f}s")


def t14_weird_names() -> None:
    sb = Sandbox("t14")
    ws = "--C-Users-测试 path 带空格--"
    sb.make_session(ws, "会话-001", b"cn" * 64)
    p = sb.run("push", "--all", "--force")
    shutil.rmtree(sb.sessions)
    sb.sessions.mkdir(parents=True, exist_ok=True)
    sb.run("pull", "--all")
    dst = sb.sessions / ws / "会话-001" / SESSION_FILE
    check("T14 中文/空格/短横线路径可用", p.returncode == 0 and dst.exists() and dst.read_bytes() == b"cn" * 64)


def t15_attachments_dir() -> None:
    """目前只同步工作区根下的文件；子目录（未来的附件）会被跳过 —— 记录当前行为。"""
    sb = Sandbox("t15")
    d = sb.sessions / "--D-TEST--" / "s1"
    d.mkdir(parents=True, exist_ok=True)
    (d / SESSION_FILE).write_bytes(b"body")
    (d / "attachments").mkdir(exist_ok=True)
    (d / "attachments" / "a.png").write_bytes(b"png")
    sb.run("push", "--all", "--force")
    copied = (sb.work / "sessions" / "--D-TEST--" / "s1" / "attachments" / "a.png").exists()
    check("T15 附件子目录当前不同步（v0.1a 已知边界）", copied is False,
          "已同步" if copied else "按预期跳过")


def main() -> int:
    if ROOT.exists():
        shutil.rmtree(ROOT, ignore_errors=True)
    ROOT.mkdir(parents=True, exist_ok=True)
    print(f"sync.py 自测 —— 沙箱 {ROOT}\n")
    for fn in (t01_push_creates_remote, t02_pull_roundtrip, t03_pull_idempotent, t04_local_mode_skipped,
               t05_include_local, t06_quiet_window, t07_unreachable_remote, t08_corrupt_state,
               t09_pull_missing, t10_mode_missing, t11_overwrite_on_pull, t12_multi_workspace,
               t13_large_file, t14_weird_names, t15_attachments_dir):
        try:
            fn()
        except Exception as err:  # 单个用例炸掉不影响其余用例，但记为 FAIL
            check(f"{fn.__name__} 抛异常", False, f"{type(err).__name__}: {err}")
    failed = [r for r in results if not r[1]]
    print(f"\n合计 {len(results)} 条断言，通过 {len(results) - len(failed)}，失败 {len(failed)}")
    if not failed:
        shutil.rmtree(ROOT, ignore_errors=True)
        print("沙箱已清理")
        return 0
    print(f"沙箱保留在 {ROOT} 供排查")
    return 1


if __name__ == "__main__":
    sys.exit(main())
