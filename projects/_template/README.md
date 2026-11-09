# Agent 骨架：零依赖、可直接跑的最小完整链路

这是所有项目的起点。它不是框架，而是一份**每一层都能被追问**的可运行 TypeScript 代码。

目标只有一个：面试官问任何一层时，你都能打开一个文件指给他看；复制它开新项目时，只需要换业务，不需要重写编排。

## 30 秒跑起来

```powershell
cd projects/_template
node src/main.ts              # 五段输出 + 缺参失败路径
node src/eval/run.ts --k 3    # pass@k / pass^k / 95% CI / 失败分布
```

要求 Node >= 24（本机验证版本 v24.21.0）。**不需要 `npm install`**，`package.json` 没有任何 `dependencies`，也没有 build 步骤。Node 原生类型剥离直接运行 `.ts`，所有相对 import 都带 `.ts` 后缀。

demo 与 eval 只使用 `MockProvider`，不发起真实网络请求。真实 provider 的适配器已经写在 `src/llm/provider.ts`，但不在 demo 中调用。

## 为什么能零依赖

| 你可能以为需要的东西 | 本项目做法 | 学到什么 |
|---|---|---|
| TypeScript 编译器 | Node 24 原生类型剥离，直接 `node src/main.ts` | 类型是开发期约束，不是运行时依赖 |
| tsx / ts-node | `"type": "module"` + 相对 import 带 `.ts` | ESM 的真实解析规则 |
| zod | 手写 `validateArgs`，支持 required/type/enum/min/max/pattern | schema 校验本质就是一组 if |
| openai SDK | 手写 `fetch` + `AbortSignal.timeout` + 状态码归一 | 网络边界必须自己看得见 |
| LangChain / LangGraph | 手写 219 行 loop + 143 行 registry | 编排本质是 while + 停止条件 |
| tiktoken | 字符数 / 4 估算，并在代码里注明误差 | 估算够用，别过早引入二进制依赖 |
| 向量数据库 | 关键词 + IDF 打分，ACL 在打分前过滤 | RAG 的关键不是数据库，是过滤时机 |
| 数据库 | 工单幂等表用模块级 `Map` 模拟 | 先把接口和幂等语义做对，再换存储 |

## 目录与七层架构

代码目录是六层，加上 `main.ts` 这个组合根，就是通常说的“七层”。依赖方向只能从外向内。

| 层 | 目录 / 文件 | 一句话职责 |
|---|---|---|
| 入口 / 组装 | `src/main.ts`, `src/eval/run.ts` | 只做依赖注入、运行、打印结果 |
| 编排 | `src/agent/loop.ts` | 循环、停止条件、工具调用并行执行与回填、死循环检测 |
| 工具 | `src/tools/` | 注册、参数校验、超时、重试、幂等、三个内置工具 |
| 模型 | `src/llm/provider.ts` | Mock / OpenAI 兼容 provider、tool_calls 解析、usage、HTTP 重试 |
| 核心 | `src/core/` | 共享类型、六类错误、预算、参数校验 |
| 可观测 | `src/obs/tracer.ts` | span 收集、JSONL 落盘、token/cost 汇总 |
| 评测 / 数据 | `src/eval/`, `data/golden.jsonl` | 金标准集、pass@k / pass^k、CI、中文报告 |

更完整的分层理由见 [`docs/adr/0001-layering.md`](docs/adr/0001-layering.md)。

## 五个关键设计决定

### 1. 工具失败返回 `ok:false`，不抛异常打断整轮

`registry.execute()` 永远返回 `ToolResult`。参数错误、权限错误、policy 拒绝都是可观察的结果，模型下次调用能看到具体原因。

`node src/main.ts` 的最后一段就是证据：故意漏掉 calculator 的 required 参数 `expression`，先打印 `errorKind=validation`，再把完整的 `validation_error: missing required field ...` 作为 observation 回填给模型。

### 2. 写操作的幂等键来自调用方，不来自模型

- `create_ticket.isWrite = true`，registry 在调用 handler **之前**检查 `ctx.idempotencyKey`；
- 同一个 key 重放返回同一个 `ticketId`，不会重复建单；
- 模型不能自己生成幂等键，否则每次都是新 key，等于没有幂等。

### 3. ACL 在打分之前过滤

`builtin.ts` 先按 `ctx.tenantId` 过滤 `DOC_CORPUS`，再做 IDF 打分和 topK。若先取 topK 再隐藏无权限文档，本租户的结果会被别人的文档挤掉，表现为“检索为空”。

### 4. 死循环靠动作签名，不靠步数

`loop.ts` 用 `toolName + stableStringify(args)` 作为签名；排序 key 后，`{a:1,b:2}` 和 `{b:2,a:1}` 视为同一动作。同一签名第 3 次出现即返回 `loop_detected`，比耗完 `maxSteps` 更早止损。

### 5. 预算检查在每一步开始前

`budget.step()` 和 `checkWallClock()` 在调用模型之前执行，`spend()` 在拿到 usage 之后执行。先检查再花钱；超限返回 `status:"budget"`，不崩溃，并保留已有消息。预算为 0 也合法，第一步就会停。

## 复制它开一个新项目

从仓库根目录执行：

```powershell
Copy-Item -Recurse .\projects\_template .\projects\p1-tool-agent
cd .\projects\p1-tool-agent
```

然后最小改造只需要动三个文件：

1. **`src/tools/builtin.ts`**：换掉 demo 工具，写你的真实工具；保留 `isWrite`、`timeoutMs`、ACL 和错误分类的写法。
2. **`src/main.ts`**：换掉 mock 脚本和真实业务流程，接入你的 provider 与 tenant 上下文。
3. **`data/golden.jsonl`**：换成你的 30+ 条真实用例。先写用例，再改实现。

`loop.ts`、`registry.ts`、`budget.ts`、`tracer.ts` 在换业务时应该保持不动。如果你发现必须改 loop，先判断：是骨架缺了一层，还是业务逻辑混进了编排层？

## 验收清单

在 `projects/_template` 下逐条执行：

- [ ] `node src/main.ts` 退出码 0，能看到 1) 每步动作与耗时、2) 最终答案、3) budget 快照、4) tracer.summary、5) trace 文件路径，以及最后的缺参失败路径。
- [ ] `node src/eval/run.ts --k 3` 退出码 0，能看到 pass@k、pass^k、95% CI 和失败 tag 分布。当前基线是 9/10，`tool_error=1`：case-003 故意触发无法修复的参数校验失败，这是评测逻辑产生的真实失败，不是脚本崩溃。
- [ ] `data/traces/*.jsonl` 每行都是合法 JSON，并且 span 有 `endMs`。
- [ ] 故意改坏一个工具，确认错误可读且会回填，而不是整个进程崩掉。例如把 `calculator` 的 `expression.pattern` 改成 `"^[0-9]+$"`，再跑 `node src/main.ts`，第一步应出现 `validation_error`；验证后改回。

校验 trace 的 PowerShell 命令：

```powershell
Get-ChildItem data/traces/*.jsonl | ForEach-Object {
  node --input-type=commonjs -e "const fs=require('node:fs');const p=process.argv[1];const lines=fs.readFileSync(p,'utf8').trim().split(/\r?\n/);lines.forEach((line,i)=>{try{JSON.parse(line)}catch(err){console.error(p+':'+(i+1)+': '+err.message);process.exit(1)}});console.log('OK '+p+' ('+lines.length+' lines)')" $_.FullName
}
```

## 故意没做的事

| 没做 | 原因 |
|---|---|
| 真实模型调用 | demo 必须零网络、可重放；`OpenAICompatProvider` 只提供适配器，不进入 demo |
| UI | 先把协议、工具和评测跑通，界面是最后一层 |
| 数据库 | 幂等表用模块级 Map 模拟，换存储只改 handler，不影响 registry |
| 部署 | 没有 Docker、CI、网关；这个骨架只验证本地单进程链路 |
| 流式输出 | demo 不联前端，加了只会模糊工具调用与最终答案的边界 |
| 向量检索 | 关键词 + IDF 已能演示 ACL 过滤时机，换向量库不应改变工具接口 |
| 多 agent | 单 agent 还没证明上限时，拆多 agent 只会增加协调成本 |
| 鉴权 / 多租户持久化 | 只有 `tenantId` 注入点，真实系统从登录态读取，绝不让模型传入 |

## 建议阅读顺序

1. 跑 `node src/main.ts`，对照五段输出看 trace 是怎么长出来的。
2. 读 `src/agent/loop.ts` 的 while 循环，数清四个停止条件。
3. 读 `src/tools/registry.ts` 的 `execute()`，数它做了几件事。
4. 读 `src/core/validate.ts`，理解一次收集所有错误。
5. 读 `src/eval/runner.ts` 的 `passAtK` / `passHatK`，理解能力上限与稳定性的区别。
6. 读两个 ADR，尤其是“工具结果必须当不可信数据”。

## 相关文档

- [ADR 0001：六层分层与依赖方向](docs/adr/0001-layering.md)
- [ADR 0002：错误分类、重试与幂等](docs/adr/0002-error-taxonomy-retry.md)
- [金标准集](data/golden.jsonl)
