# dsh-session-anywhere

> 一条会话一个开关：**这条对话要不要跟着你走。**
> 给 DeepSeek Harness 的输入框工具行加一个 chip，把它切到「☁ 云同步」就进你**自己的私有 git 仓库**，切到「🖥 仅本机」就一个字节都不离开这台机器。

---

## 它解决什么

默认情况下，会话只活在这一台电脑的 `~/.dsh/sessions` 里：换台机器接着聊不可能，重装系统等于全丢。
现有的做法有两种，都有代价：

| 做法 | 代价 |
|---|---|
| 整库镜像（把所有会话都传到云端） | 你没法只传一部分——公司项目、私人笔记被迫一起上云 |
| 手动 `/export` 导出 zip | 每次都靠记性，忘了就是忘了 |

这个插件把选择权放到**每条会话**上：默认「仅本机」，你想让哪条跟着你走，就切哪条。

## 长什么样

输入框左侧工具行多一个 chip，显示当前会话的存储模式：

```
[+]   [☁ 云同步 ▾]   …                      DeepSeek-V4.1-Flash
```

点它弹出菜单，两项带勾：

- `☁ 云同步` — 切过去会先弹一个确认面板，列出这条会话的消息数、工具调用数、体积，确认后才记入备份计划；
- `🖥 仅本机` — 立即生效，不弹框；**已上传的副本不会被删**，只是之后的备份不再包含它。

chip 显示 `⚠ 未知` 时，说明引擎里还查不到这条会话（新会话、或引擎没配置好）。

## 要求

| 项 | 要求 |
|---|---|
| DSH | 0.2.x（web 客户端） |
| Python | **3.11+**（引擎是标准库写的，无第三方依赖） |
| git | 任何能 `git push` 的版本 |
| 云端 | 一个**私有** git 仓库（GitHub/GitLab/Gitee 都行，走 SSH key 或已配置的凭据） |

## 安装

在 DSH 插件市场搜索 `dsh-session-anywhere` 安装，然后**重启 DSH**（浏览器端模块清单只在启动时扫描）。

安装后先自检：

```powershell
Invoke-RestMethod http://127.0.0.1:3080/session-cloud/health
```

返回 `{"ok":true,...}` 且 `python.file` 有值，说明宿主半边已经起来了。如果 `ok:false`，`error` 里会写明它在哪几个路径找过 `sync.py`。

## 首次配置

引擎需要知道推到哪个仓库（只需一次）：

```powershell
# 找到引擎（版本号路径可能不同，可在插件目录下确认）
$engine = "$env:USERPROFILE\.dsh\profiles\tauri\node_modules\dsh-session-anywhere\engine\sync.py"

python $engine config --remote git@github.com:you/dsh-sessions-private.git
python $engine status
```

配置写在 `%USERPROFILE%\.dsh\session-anywhere\config.json`，状态写在同目录 `state.json`。

## 怎么运作（三句话）

1. **按字节搬运，不解析**：会话文件是 zstd 压的 JSONL，格式是宿主私有约定、还有 v0→v4 的迁移史，所以我们不碰内容，只算 sha256 搬运。这保证"拉回来的东西"和原件**逐字节一致**。
2. **git 只是传输层**：远端布局 `sessions/<workspace>/<session>/session.v4.jsonl.zstd` + `index/<workspace>/<session>.json`，每次备份一个 commit，天然有历史可回滚，不需要任何服务端。
3. **未闭合不上传**：文件 30 秒内还在改就跳过（`--force` 可强推），避免把写了一半的会话传上去。

## 安全默认值

- **默认仅本机**：装上之后不切模式，什么都不会上传。
- **仓库必须私有**：插件不做客户端加密（v0.3 计划用 age），云端是明文 zstd。所以仓库私有是硬要求。
- **切回仅本机不删云端**：想删云端副本要自己去仓库里删，插件不替你删数据。
- **不带附件**：v0.1 只同步会话文件本身，附件目录不同步（已知边界，见路线图）。

## 换机 / 重置后怎么恢复

```powershell
python $engine pull --all
```

拉回来之后会话会出现在 DSH 列表里——因为宿主每次列会话都是重新扫盘（`readdir` + 解析首行 header），不依赖任何索引注册。

## 已知边界（v0.1）

- 附件不同步；
- 跨机器工作区路径不同时，目录按 workspace 原名落盘，`cwd` 不做改写（v0.2）；
- 未做客户端加密（v0.3，age）；
- 未闭合判断用 30 秒静置窗口，是启发式，不是协议级保证；
- 只在 Windows + DSH 0.2.2-rc.1 上实测。

## 与其他会话同步插件的区别

| | 本插件 | 全量镜像类 | 逐会话切换类 |
|---|---|---|---|
| 粒度 | **单条会话** | 整库 | 单条 |
| 后端 | **你自己的私有 git 仓库**（零服务端） | 各家方案不同 | 通常需要配置账号 |
| 传输 | 字节原样、sha256 可核 | 解析/重打包 | 常有格式转换 |
| 加密 | 暂无（v0.3） | 部分有 | 部分有 |

如果你要的是"整库镜像 + 端到端加密"，市面上已有成品（例如 npm 上的 `dsh-session-cloud`）；这个插件的差异点是**逐会话选择**和**不引入服务端**。

## 开发

```
plugins/session-cloud/
  sync.py                 引擎（开发与自测的源）
  selftest.py             15 组异常场景自测，跑在 .tmp-selftest/ 沙箱里
  dsh-plugin/             插件包（也就是发布到 npm 的内容）
    engine/sync.py        ← 发布前从 ../../sync.py 拷过来
    lib/index.js          宿主半边：三个 HTTP 端点
    lib/client.js         浏览器半边：chip + 菜单
```

```powershell
python selftest.py            # 21 条断言
node --check dsh-plugin/lib/index.js
```

## License

MIT
