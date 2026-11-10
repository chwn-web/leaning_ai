# dsh-session-cloud（DSH Web 插件 v0.1）

在**每条会话**的输入框工具行左侧加一个状态按钮：`🖥 仅本机` / `☁ 云同步`。
点开可以切换这条会话的存储策略——切换本身只写标记，真正的搬运由 `session-cloud/sync.py` + 定时备份任务完成。

## 为什么是"标记 + 引擎"而不是"点一下就上传"

上传要判断"这条会话是不是还在写"（未闭合的 turn 传上去就是半截），还要处理附件、冲突、多机并发。
v0.1 把这些交给已经验证过的引擎（sha256 记账、30 秒静置判断、原子落盘、git 作传输层），
插件只做它该做的事：**让人看得见、点得到**。

## 装在哪儿

```
<profile>/node_modules/dsh-session-cloud/
├── package.json          # dsh.client + dsh.bundle.patch
├── cordis.patch.yml      # 一行 insert，把插件挂进宿主
├── lib/index.js          # 宿主半边：GET /session-cloud/state、POST /session-cloud/mode、GET /session-cloud/health
├── lib/client.js         # 浏览器半边：注册 conversation.input.left 的 chip
├── install.ps1           # 安装
├── uninstall.ps1         # 卸载 / 回滚
└── session-cloud.json    # 安装时写入，指向引擎目录（装进 node_modules 后相对路径就断了）
```

## 安装

```powershell
cd D:\TCL\leaning_AI_agent\plugins\session-cloud\dsh-plugin
powershell -ExecutionPolicy Bypass -File .\install.ps1
# 自定义路径：
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ProfileDir C:\Users\me\.dsh\profiles\web -EngineDir D:\somewhere\session-cloud
# 只看会做什么：
powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
```

脚本做四件事，全部幂等：

1. 备份 profile 的 `package.json` → `package.json.bak-session-cloud`（**已存在则不覆盖**，保住最初那份）；
2. 拷本目录到 `<profile>\node_modules\dsh-session-cloud`（先删旧版本）；
3. 写 `<装好的包>\session-cloud.json`，内容是 `{ "engineDir": "<session-cloud 绝对路径>" }`；
4. 把 `"dsh-session-cloud"` 追加进 `<profile>\package.json` 的 `dsh.profile.bundles`。

**不改 profile 自己的 `cordis.patch.yml`**——本包的 `cordis.patch.yml` 由宿主在该 bundle 加入后自动合并。
不改 `dependencies`（`node_modules` 里存在即可被 `resolve.paths` 找到）。

### 装完必须重启

宿主的路由表和客户端的 bundle 表都是**启动时**装配的，刷新浏览器不够：

1. 停掉正在跑的 `dsh web`（终端里 Ctrl+C，或退出托管它的桌面进程）；
2. 重新启动，再打开 <http://127.0.0.1:3080>。

自检：

```powershell
Invoke-RestMethod http://127.0.0.1:3080/session-cloud/health
```

返回里 `engine.exists` 应为 `true`、`python.working` ≥ 1；此时输入框左下角出现胶囊。

## 卸载 / 回滚

```powershell
cd D:\TCL\leaning_AI_agent\plugins\session-cloud\dsh-plugin
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1                  # 摘掉 bundle + 删包
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RestoreManifest # 再把 package.json 恢复成备份
```

卸载**不碰引擎目录**（`sync.py`、`config.json`、`state.json` 与 `.work/`），云上的会话不会被删。
手工回滚等价于：`Copy-Item <profile>\package.json.bak-session-cloud <profile>\package.json -Force`、删掉
`<profile>\node_modules\dsh-session-cloud`、重启。

## 端点

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/session-cloud/state?sessionId=<id>` | 一条会话的当前模式、大小、最后同步时间 |
| POST | `/session-cloud/mode` | body `{ sessionId, mode: "cloud"\|"local" }`，写标记 |
| GET | `/session-cloud/health` | 引擎与解释器探测（安装自检） |

三个端点都自己接管响应生命周期（`writeHead` + `end`），任何异常都转成 JSON 错误码，
不会把宿主 fiber 打崩。命令执行一律走 `spawnSync`，超时 20 秒（可用 `DSH_SESSION_CLOUD_TIMEOUT_MS` 覆盖）；
如果平台不允许管道 stdio（`EPERM`），自动改用临时文件重定向，语义不变。

## 已知边界

- 只标记，不搬运（搬运在引擎里，由计划任务每 2 小时执行）；
- 附件（`~/.dsh/attachments`）暂不同步；
- 换机后工作区路径必须一致（会话目录名按工作区路径编码）；
- 插件集合变化**重启后**生效（宿主只在启动时扫一遍 bundle）；
- 客户端半边加载失败**不会白屏**：`apply()` 全包 try/catch，组件渲染失败直接 `return null`，
  最坏情况是"没有这个胶囊"，输入框照常可用；
- 若 `/session-cloud/*` 已被别的路由占用，宿主启动时会抛 `duplicate prefix route`——先卸载同名插件。

## 自测（无需安装）

```powershell
cd D:\TCL\leaning_AI_agent\plugins\session-cloud
node --check dsh-plugin\lib\index.js
node --check dsh-plugin\lib\client.js
node .work\verify-host.mjs     # 8 个 host 用例，假 req/res
node .work\verify-client.mjs   # 31 个 client 用例，假 __ModuleLoader__ + 假 React
```
