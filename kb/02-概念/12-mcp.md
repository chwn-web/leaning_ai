# MCP：标准化的是"发现/传输/鉴权"，不是模型能力

**① 一句话定义**
MCP（Model Context Protocol）是一套基于 **JSON-RPC 2.0** 的开放协议，把"工具与数据源"标准化成 **server**，由 **host**（你的应用）里的 **client** 接入——解决的是 **M×N 适配爆炸**：M 个应用 × N 个数据源，从 M×N 个集成降到 M+N。

**② 它解决什么问题**
以前每接一个系统（Jira/数据库/内部 API）就要为每个 AI 应用写一遍适配器，且工具描述、鉴权、传输各写一套。MCP 把这些抽成协议层。

**③ 关键机制**

| 方面 | 事实 |
|---|---|
| 角色 | **host**（宿主应用，管权限与 UI）→ **client**（1:1 连接某个 server）→ **server**（提供能力） |
| 服务端原语 | `tools`（可执行，有副作用）、`resources`（只读数据）、`prompts`（可复用提示模板） |
| 客户端原语 | `sampling`（让 server 反向请求模型）、`roots`（暴露本地目录边界）、`elicitation`（向用户追问） |
| 传输 | **stdio**（本地进程，最简单）/ **Streamable HTTP**（远程，替代旧的 SSE 双端点） |
| 生命周期 | `initialize` 做**能力协商**（双方声明支持哪些原语/版本），再 `initialized` |
| 鉴权 | **OAuth 2.1**；token 必须绑定 **audience**（不能给 A server 的 token 拿去调 B）；**禁止 token passthrough**（不许把用户 token 原样转发给下游） |
| 与 function calling 的关系 | **可叠加，不是替代**：MCP 管"工具从哪来、怎么连、怎么鉴权"；FC 管"模型怎么表达要调用谁"。本地三个工具直接注册更简单，需要复用/跨应用才上 MCP |

**④ 边界与代价**
- **安全面变大**：tool poisoning（恶意 server 在描述里藏指令）、rug pull（批准后偷偷改工具）、混淆代理（用你的权限替攻击者调工具）。
- 多一跳网络 → 延迟与失败点增加；server 挂了你得降级。
- 不是所有场景都值得：一个应用里三个私有工具，直接 `registry.register()` 更省事。
- 版本演进快（规范在迭代），要写清依赖的协议版本。

**⑤ 工程落点**
- `projects/_template/src/tools/registry.ts` 是"本地工具"形态；**MCP server 只是把同一份 `ToolSpec` 暴露成远程端点**——接口同构，所以 P3/P4 加 MCP 时不用改 agent 循环
- 届时新增：`mcp/server.ts`（暴露 tools）、`mcp/client.ts`（连接远端并转成 `ToolDefinition`）、`mcp/allowlist.ts`（固定版本 + 哈希校验）
- 面试加分点：**自己写一个 server 并把工具挂进去**，比"我调用过 MCP"值钱得多

**⑥ 面试追问（三层）**
1. **怎么衡量**：工具调用成功率、server 可用性、鉴权失败率、审计覆盖率；安全性上用红队用例（恶意描述/越权参数）验证拦截率。
2. **为什么不用另一方案**：为什么不直接用 function calling？→ 本地少量工具可以，但跨应用复用与统一鉴权不行。为什么不用 REST API 直连？→ 缺发现/协商/统一权限语义。
3. **线上坏了怎么定位**：看 client 侧 span（连接/初始化/调用三段）→ 区分协议错误（版本/能力不匹配）、鉴权错误（audience/scope）、server 内部错误。

**关联**：[04-工具调用](04-工具调用.md)｜[13-安全与注入](13-安全与注入.md)｜题库 P14
