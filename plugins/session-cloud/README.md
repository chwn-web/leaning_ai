# session-cloud —— 会话级「仅本机 / 云同步」

给 DSH 的每一条会话一个开关：**🖥 仅本机**（默认，一个字节都不出网）或 **☁ 云同步**（上传到你的私有 git 仓库，换电脑能接着聊）。

- 设计稿：[DESIGN.md](DESIGN.md)（含状态机、云端布局、平台落点、安全红线、里程碑）
- 现阶段：**v0.1a 引擎已可用并验证**（`sync.py`，零第三方依赖），UI 插件（输入框左下角的 chip）是下一步。

## 为什么不是"现成插件"

| 现成方案 | 它的模型 | 差在哪 |
|---|---|---|
| `dsh-session-sync`（PerryLink） | 整个 `sessions/` 目录镜像进 git | 全量上传，"公司项目 + 学习项目"没法只挑一条 |
| `@linbin-mk/dsh-session-sync` | 逐会话勾选同步 | 只有"同步/不同步"两态，没有"云"的概念，也没有上传前的数据清单与体积预估 |
| 两者都不管 | — | **附件**不在同步范围；**没有换机向导** |

我们要的是：**逐会话两态开关 + 上传前清单 + 附件 + 换机向导**。

## 快速开始

```powershell
cd D:\TCL\leaning_AI_agent\plugins\session-cloud

# 1. 配远端（私有仓库；本地路径也行，不存在会自动 git init --bare）
python sync.py config --remote git@github.com:<you>/dsh-sessions-private.git --branch main

# 2. 看本机有哪些会话、各是什么模式
python sync.py status

# 3. 把某条会话切成云同步并上传
python sync.py mode --session session-f2cbe70e --to cloud
python sync.py push --session session-f2cbe70e

# 4. 另一台机器上拉回来
python sync.py pull --session session-f2cbe70e
```

## 命令

| 命令 | 说明 |
|---|---|
| `config --remote --branch --work --sessions-root` | 写配置；`--sessions-root` 主要用于测试 |
| `status [--json]` | 列出会话：模式 / 大小 / 修改时间 / 同步时间 |
| `mode --session <id> --to cloud\|local` | 改存储模式（状态在 `state.json`，插件版搬进 storage domain） |
| `push --session <id> \| --all [--force] [--no-git]` | 打包 → 写索引 → commit → push |
| `pull --session <id> \| --all [--no-git]` | fetch → 按会话落位 |

`--no-git` 只把文件写进本地工作副本、不做 git 操作：用于离线或受限环境验证字节链路。

## 远端长什么样

```
sessions/<workspaceKey>/<sessionId>/session.v4.jsonl.zstd   # 会话数据，字节搬运
index/<workspaceKey>/<sessionId>.json                      # 索引：大小/sha256/时间
```

**不解析会话内容**——格式是 harness 私有约定且一直在演进（v0→v4），解析重建等于每次升级碎一次。代价：v0.1 不认识附件，也判断不了 turn 是否闭合，只能退化成"文件静置 30 秒以上才允许推送"。

## 已验证（2026-11-10）

- 打包 1 条真实会话（586,224 B）→ push 到本地 bare 仓库，提交 `8fdd06d`，树里能看到 `sessions/.../session.v4.jsonl.zstd`；
- 拉到全新的 sessions 根目录 → **sha256 与源文件完全一致**（`0f3f229a8743…`）；
- `--no-git` 路径同样 sha256 一致（离线验证用）。

## 安全默认值

1. 默认仅本机；不配置远端就什么都不会发生。
2. 仓库必须**私有**（公开仓库同名会话会把公司内容泄露出去；v0.3 加自动检测拒绝）。
3. 切回本机**不删云端**；删云端要二次确认（v0.2 的 UI 里做）。
4. v0.3 前云端是明文，只传不含公司内部信息的会话。

## 环境注记

- 需要 `python 3.11+`、`git`。
- 本机 Windows 沙箱会拦 `msys` 命名管道：`git clone/fetch/push` 在受限模式报 `sh.exe: couldn't create signal pipe, Win32 error 5`。正常桌面环境无此问题；受限时用 `--no-git` 验证链路，或给进程完整访问权限。
- `config.json` / `state.json` / `.work/` 都是本机私有数据，已在 `.gitignore` 里排除。

## 下一步（按 DESIGN.md §9）

1. **UI 插件**：`conversation.input.left` 放 chip（🖥 仅本机 ▾ / ☁ 云同步），切换时弹数据清单确认框。
2. 把 `state.json` 换成 `ctx.storage.domain('session-cloud')`，把 `push/pull` 挂到 `/_session-cloud/*` 路由后由 UI 调用。
3. 附件同步 + 换机向导 + 加密（v0.2 / v0.3）。
