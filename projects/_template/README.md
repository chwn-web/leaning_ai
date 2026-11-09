# Agent 骨架：零依赖、可直接跑的最小完整链路

> 这是本仓库所有项目的**起点**。不是一个框架，是一份"每一层都能被追问"的可运行代码。
>
> 设计目标只有一个：**面试官问任何一层时，你都能打开一个文件指给他看。**

## 30 秒跑起来

```powershell
cd projects/_template
node src/main.ts              # 5 个场景：正常/参数错/死循环/写操作/预算
node src/eval/run.ts --k 3    # 评测：pass@k、pass^k、95% CI
```

要求：Node ≥ 22（本机 v24.21.0）。**不需要 npm install**，`package.json` 里没有任何依赖。

## 它为什么能零依赖

| 你可能以为需要的东西 | 实际做法 | 学到什么 |
|---|---|---|
| TypeScript 编译 | Node 24 原生类型剥离，直接 `node src/main.ts` | 类型只是开发期约束，不是运行时依赖 |
| 相对导入不带后缀 | 全部写 `.ts` 后缀 + `"type": "module"` | ESM 的真实解析规则 |
| tiktoken 算 token | `chars / 4` 估算，并在注释里写明误差 | 估算够用，别过早引入二进制依赖 |
| zod 校验参数 | 手写 `validateArgs`，支持 required/enum/min/max/pattern | schema 校验的本质就是一堆 if |
| LangChain/LangGraph | 手写 219 行 loop + 143 行 registry | 编排的本质是 while + 停止条件 |
| 向量数据库 | 关键词 + IDF 打分，**ACL 在打分前过滤** | RAG 的关键不是数据库，是过滤时机 |
| openai SDK | 手写 `fetch` + 超时 + 状态码分类 | 网络边界必须自己看得见 |

**这不是反框架**。是先把 500 行读透，再看框架就知道它在替你做什么、在哪一层。

## 目录 → 七层架构

对应 [`kb/01-全景图.md`](../../kb/01-全景图.md)：

| 文件 | 层 | 回答什么问题 | 行数 |
|---|---|---|---|
| `src/main.ts` | 入口 | 5 种真实情况各长什么样 | ~330 |
| `src/agent/loop.ts` | L5 编排 | 什么时候继续、什么时候停、怎么判死循环 | 219 |
| `src/tools/registry.ts` | L2 工具 | 校验/超时/重试/幂等/错误分类放在哪 | 143 |
| `src/tools/builtin.ts` | L2 工具 | 读工具与写工具的区别 | 422 |
| `src/llm/provider.ts` | L3 模型 | 网络、重试、usage、tool_calls 解析 | 320 |
| `src/core/validate.ts` | L2 工具 | 一次性报出所有参数错误 | 118 |
| `src/core/budget.ts` | L0 横切 | 步数/成本/墙钟三个硬边界 | 111 |
| `src/core/errors.ts` | L0 横切 | 6 类错误 + 归一化 + 可重试判定 | 61 |
| `src/core/types.ts` | 全层 | 只放类型，零依赖，防循环引用 | 117 |
| `src/obs/tracer.ts` | L0 横切 | span 收集、JSONL 落盘、汇总 | 107 |
| `src/eval/dataset.ts` | L0 横切 | 金标准集逐行读、坏行不拖垮整批 | 52 |
| `src/eval/runner.ts` | L0 横切 | pass@k vs pass^k、置信区间、失败分桶 | 143 |
| `src/eval/run.ts` | L0 横切 | 判定器 + 组装 + 报告 | ~200 |
| `data/golden.jsonl` | L0 横切 | 10 条种子用例（含 4 条"应该拒绝"） | 10 |

## 五个关键设计决定（每个都值得被追问三层）

### 1. 工具失败返回 `ok:false`，不抛异常

`registry.execute()` 永远返回 `ToolResult`。原因：**抛异常会中断整个 run，而模型本来可以自己修**。

`src/main.ts` 的 S2 场景就是证据：第一次调用缺 `expression` → 返回 `validation_error: missing required field "expression" (string)` → 模型看到具体错误 → 第二次补上 → 成功。

反例（错误做法）：`throw new ValidationError()`，然后顶层 catch 返回"抱歉出错了"。用户什么也没得到，你什么也不知道。

### 2. 写操作的幂等键来自调用方，不来自模型

- `create_ticket.isWrite = true` → registry 在**执行 handler 之前**检查 `ctx.idempotencyKey`，没有就拒绝。
- 同一个 key 重放 → 返回同一个 `ticketId` + `idempotentReplay: true`（S4b / S4c）。

为什么模型不能自己生成幂等键：**模型每次都生成新的**，等于没有幂等。真正的 key 来自 HTTP 请求 ID / 用户操作 ID。

### 3. ACL 在打分之前过滤，而不是取完 top-k 再隐藏

`builtin.ts` 里 `DOC_CORPUS.filter(...)` 发生在 `scored` 之前。

后过滤的后果不是"看到别人的文档"，而是**你自己的文档被别人的文档挤掉名额，结果集变空**（题库 P7）。这是 RAG 里最常见、最难复现的 bug。

### 4. 死循环靠动作签名，不靠步数

`loop.ts:136`：

```ts
const signature = `${call.name}:${stableStringify(call.args)}`;
if (count >= 3) return { status: "loop_detected", ... };
```

`stableStringify` 对 key 排序，所以 `{a:1,b:2}` 和 `{b:2,a:1}` 视为同一动作。**只用 maxSteps 罚款不解决问题**：40 步预算里它可能已经花掉 30 步在同一个无效调用上。

### 5. 预算检查在每一步开始前

`budget.step()` / `checkWallClock()` 在调用模型之前执行（`loop.ts:85-86`），`spend()` 在拿到 usage 之后。

顺序很重要：**先检查再花钱**，而不是"花完看超没超"。S5 场景：maxSteps=2，第 3 次进入循环时立刻返回 `status:"budget"`，不是抛异常崩溃。

## 用这个骨架开新项目（3 步）

```powershell
Copy-Item -Recurse projects/_template projects/p1-tool-agent
cd projects/p1-tool-agent
```

然后只改三个文件：

1. **`src/tools/builtin.ts`** — 换掉 demo 工具，写你真正的工具（保留 `isWrite` / `timeoutMs` / ACL 的写法）。
2. **`src/main.ts`** — 换掉 5 个场景的 script，变成你的真实业务流程。
3. **`data/golden.jsonl`** — 换成你的 30+ 条真实用例（**先写用例，再写代码**）。

其余文件（loop / registry / budget / tracer / eval）**一行都不用改**。如果非要改，先问自己：是骨架不对，还是我在往里塞业务逻辑？

## 故意没做的东西（面试被问到就这么答）

| 没做 | 为什么 | 被问到时怎么答 |
|---|---|---|
| 流式输出 | demo 不联前端，加了只会模糊重点 | "流式在 L6，关键是工具调用的参数不能当正文推给前端（题库 P9）" |
| 真实向量检索 | 关键词+IDF 已能演示 ACL 过滤时机 | "换成向量库只改 `searchDocsTool` 一个函数，接口不变" |
| 工具并发限流 | 骨架里 4 个工具不会触发 | "生产上按 provider 的 RPM 做信号量，429 走指数退避" |
| 持久化记忆 | 记忆的难点在写入策略不在存储 | "先把 working notes 做对，再谈长期记忆（kb/02-概念/07-记忆）" |
| 多 agent | 2–3 个 specialist 才有收益，单 agent 撑不住时再加 | "先证明单 agent 的上限，再谈拆分" |
| 鉴权/多租户隔离 | 只有 `tenantId` 一个字段 | "真实系统从登录态注入 tenantId，工具层不再接受模型传入" |

## 建议的阅读顺序（第一次看）

1. `node src/main.ts` 跑一遍，看 S1 的 trace 文件长什么样。
2. 读 `src/agent/loop.ts` 的 while 循环，找到 4 个停止条件。
3. 读 `src/tools/registry.ts` 的 `execute()`，数一下它做了几件事。
4. 读 `src/core/errors.ts` 的 `categorize()`，想清楚为什么"分类"比"字符串匹配"重要。
5. 读 `src/eval/runner.ts` 的 `passAtK` / `passHatK` 两行，理解为什么生产看后者。

## 验收清单（改完自己的项目后逐条对）

- [ ] `node src/main.ts` exit 0，且 5 个场景的状态符合预期
- [ ] `node src/eval/run.ts --k 3` 能输出 pass@k / pass^k / CI，且样本 <30 时有警告
- [ ] 每个写工具都有 `isWrite: true` + 幂等键 + 人工确认
- [ ] 每个工具都有 `timeoutMs`，没有无限等待
- [ ] `data/traces/` 里的 JSONL 能还原一次运行的全部步骤
- [ ] 没有任何 `npm install` 也能跑

## 相关文档

- 七层架构：[`kb/01-全景图.md`](../../kb/01-全景图.md)
- 这个骨架为什么这么分层：[`docs/adr/0001-layering.md`](docs/adr/0001-layering.md)
- 错误分类与重试边界：[`docs/adr/0002-error-taxonomy-retry.md`](docs/adr/0002-error-taxonomy-retry.md)
- 怎么用它开新项目：[`kb/03-框架/03-统一项目骨架.md`](../../kb/03-框架/03-统一项目骨架.md)
