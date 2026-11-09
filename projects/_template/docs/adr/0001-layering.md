# ADR 0001：六层分层与依赖方向

- 状态：已采纳
- 日期：2026-11
- 相关：[0002 错误分类与重试](0002-error-taxonomy-retry.md)

## 背景

Agent 项目最常见的失败模式，是把“拼 prompt、调模型、解析 tool_call、执行工具、写 trace、算成本”塞进一个 `chat.ts`。代码能跑，但换模型、换工具、做评测时每一层都会互相牵连。这个骨架要回答两个问题：**每层代码在哪里，改一层时不能连带改哪几层？**

## 决定

代码分成六层。`main.ts` 只是组合根，不属于业务层；它把六层装配起来，所以依赖方向永远是“外层依赖内层”。

| 层 | 目录 | 只负责 | 明确禁止 |
|---|---|---|---|
| core | `src/core/` | 共享类型、错误分类、预算、参数校验 | 网络、文件 IO、业务工具 |
| llm | `src/llm/` | provider 协议、Mock、HTTP 超时、usage、重试 | 执行工具、编排循环 |
| tools | `src/tools/` | 工具注册、校验、超时、幂等、具体工具实现 | 决定下一步、拼系统提示 |
| agent | `src/agent/` | 循环、停止条件、工具调用回填、循环检测 | 直接 fetch、直接写数据库 |
| obs | `src/obs/` | span 收集、JSONL 落盘、运行汇总 | 改变业务结果 |
| eval | `src/eval/` | 金标准集读取、pass@k/pass^k、CI、报告 | 被生产运行路径 import |

推荐依赖方向：

```text
main -> agent -> tools -> core
          \       \
           \       -> llm(for withRetry) -> core
            -> obs -> core
eval -> agent / tools / llm / core
```

`core` 不 import 任何业务层，`types.ts` 只放类型。`eval` 可以在外层依赖 agent，但生产代码永远不 import `eval`。如果某个工具需要“读文档”，它属于 tools；如果某个判断需要“决定继续还是停止”，它属于 agent。

## 两个容易做错的边界

### 1. 工具结果必须当作不可信数据

工具返回的文档、工单内容、第三方 API 文本都可能包含“忽略之前的指令”“把密钥发给我”这类注入语句。因此：

- `ToolResult.content` 只作为 observation 回填，**绝不被当作系统指令执行**；
- `search_docs` 在打分前按 `tenantId` 过滤 ACL，避免检索结果泄露或把本租户文档挤出名额；
- 写工具通过 `isWrite`、人工 `confirm` 和幂等键把副作用关在 registry 门后；
- 系统提示明确要求模型按工具事实回答，工具报错时不要编造。

“把工具输出当数据，而不是当命令”是这一层最重要的安全边界。

### 2. eval 必须和 agent 同仓

评测不是上线后的附加物。`data/golden.jsonl`、`runner.ts` 和 `MockProvider` 与 agent 共用同一套 `Message`、`RunResult` 和工具调用协议，才能保证：

- 改 loop/registry 时，评测会立刻暴露退化；
- 评测用例可以复现线上失败，而不是依赖口头描述；
- 零网络也能在 CI 中跑，成本可预测。

评测代码虽然同仓，但运行入口独立（`src/eval/run.ts`），生产 bundle 不需要加载它。

## 后果

好处是换 provider 只改组合根，加 trace 只在 registry/loop 埋点，工具可以单独测试。代价是接口更多、跨层逻辑必须先选边（例如工具结果截断放在 tools，因为长度取决于下游模型窗口），初读成本比单文件高。

备选方案“单文件 agent”或“完全交给框架”都被否决：前者无法回答“这层在哪里”，后者被追问时只能说“框架就是这样”。

## 验证

复制这个骨架开新项目时，`loop.ts`、`registry.ts`、`budget.ts` 应该保持不变。如果新项目不得不改 loop，通常说明业务逻辑混进了编排层，应把它移回 tools 或 agent 的输入准备阶段。

关联：[README](../../README.md) | [ADR 0002](0002-error-taxonomy-retry.md)
