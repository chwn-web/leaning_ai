# dsh-session-anywhere —— 会话级「仅本机 / 云同步」

给 DSH 的每一条会话一个开关：**🖥 仅本机**（默认，一个字节都不出网）或 **☁ 云同步**（上传到你的私有 git 仓库，换电脑能接着聊）。

- 设计稿：[DESIGN.md](DESIGN.md)（含状态机、云端布局、平台落点、安全红线、里程碑）
- 发布用包：`dsh-plugin/`（npm 名 **`dsh-session-anywhere`**，含 `engine/sync.py`、LICENSE、icon、发布级 README）
- 现阶段：**v0.1 引擎 + UI 插件都已跑通**（宿主端点 `/session-cloud/{health,state,mode}` 实测 200，输入框左下角出现 chip）

> 为什么改名：npm 上 `dsh-session-cloud` 已被占用（v0.1.7，全库 E2E 镜像）。我们做的是**逐会话选择 + 零服务端 git 后端**，定位不同。

## 安装（桌面版）

桌面版真正用的是 `~/.dsh/profiles/**tauri**`（`web` 是命令行 `dsh web` 用的，装错那里看不到 chip）。

```powershell
# 推荐：走官方通道
#   plugin_manager install_bundle  target = file:D:\TCL\leaning_AI_agent\plugins\session-cloud\dsh-plugin
# 手工等价操作（pnpm 不可用时）：
#   1) 拷贝 dsh-plugin → <profile>\node_modules\dsh-session-anywhere
#   2) 把 "dsh-session-anywhere" 加进 <profile>\package.json 的 dsh.profile.bundles
#   3) 重启 DSH
```

自检：`Invoke-RestMethod http://127.0.0.1:3080/session-cloud/health`

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

**换机演练（真做了一遍"删本地 → 云端拉回"）**：拿真实子代理会话 `4ae16c7d-…`（288,718 B），`push` 后把本机会话目录整体移走，再 `pull` 回来：

- sha256 与原件一致（`d9f22622…`）；
- 解开 zstd 首行 header：`id`、`cwd`、`version` 都在，是能被加载的会话而不是裸字节；
- 说明"列表里会不会出现"不需要注册：DSH 的 `list()` 每次都 `readdir` 扫 `<root>/<project>/<session>/session.v4.jsonl.zstd` 并解析 header，`workspace.json`/`storages` 只是视图态。

**两条硬约束**（踩出来的）：1. **别在 `sessions/` 根目录留备份副本**（`.bak` 也不行）——同一个 id 出现两份会让扫描器直接抛 `duplicate JSONL session id`，整个会话列表报废。备份只在 git 仓库里。
2. `pull` 落盘是原子的（先写 `.part` 再 `os.replace`），避免扫描器读到半截文件。

另：子代理会话 id **不带** `session-` 前缀，主会话带（`session-…`）；`--session` 传不传前缀都能匹配。

## 模式语义（v0.1b，实测过）

- `mode --to local` / chip 切「仅本机」之后，`push --all` **不会再上传它**，输出里会写 `按「仅本机」跳过 N 条`；云端保留最后一次的快照，不会删。
- 点名强推某条：`push --session <id> --include-local`（只影响 `--session` 指定的那一条）。
- 没有被记录过模式的会话，按 `cloud` 处理（先保证"机器重置也不丢"）；要排除就显式设成 local。
- **修过一个会伤数据的 bug**：旧版 `push` 完全忽略 mode，还会把 `mode` 强制写回 `cloud` —— 等于每 2 小时的自动备份把用户刚点的「仅本机」悄悄改回云同步，并且照样上传。现在 mode 只由 `mode` 命令/chip 写。

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


## 发布（npm + 插件市场）

插件已改名为 **`dsh-session-anywhere`**（npm 上 `dsh-session-cloud` 已被他人占用，且那个是全库镜像、我们是逐会话选择）。
独立的发布仓库已拆好：`D:\TCL\dsh-session-anywhere`（`git init` 已提交 `f9440b6`，`pnpm pack --dry-run` 仍是同样的 8 个文件）。

上架路径（awesome-dsh-plugin）：

1. 在 GitHub 建公开仓库 `chwn-web/dsh-session-anywhere`，加 topic **`dsh-plugin`**，把该目录推上去；
2. `pnpm publish`（需要 npm 登录；本机 `%USERPROFILE%\.npmrc` 目前没有 token）；
3. 仓库满 1 天后，向 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR，只加一个文件
   `data/plugins/chwn-web__dsh-session-anywhere.yml`（内容已生成在发布仓库的 `submit/` 里）；
4. 合并后自动出现在市场卡片，安装命令由目录侧生成 `dsh plugin add dsh-session-anywhere`。

分类用 `session`。收录硬门槛：`package.json` 必须声明 `dsh.bundle`（我们已声明）、仓库满 1 天、带 `dsh-plugin` topic、有真实可用代码、持续维护。
