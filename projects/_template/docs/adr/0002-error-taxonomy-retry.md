# ADR 0002：错误分六类，只有 transient 允许自动重试

- 状态：已采纳
- 日期：2026-11
- 相关：[0001 分层](0001-layering.md)

## 背景

最初的写法通常是 `catch (e) { return "出错了" }`。这会导致两种相反的事故：

1. 该重试的 429/超时直接失败，用户看到“服务异常”；
2. 不该重试的参数错误、权限错误被反复重试，写操作因此重复执行。

因此必须先回答：**这个错误值不值得再来一次？** 答案不能依赖错误字符串的文案，而要靠进入上层前的统一分类。

## 决定

`core/errors.ts` 把异常归一成六类，`ErrorCategory` 定义在 `core/types.ts`：

| 分类 | 含义 | 自动重试 | 典型来源 | 给谁看 |
|---|---|---|---|---|
| `transient` | 暂时故障，重试可能成功 | 是 | 429、5xx、超时、连接重置 | 调用方，可提示“正在重试” |
| `permanent` | 确定性失败，重试无用 | 否 | 404、未知工具、解析失败 | 用户/人工 |
| `policy` | 业务规则不允许 | 否 | 未确认的写操作、缺幂等键 | 用户，要求确认 |
| `permission` | 无权限 | 否 | 401、403 | 用户/管理员 |
| `validation` | 参数不合法 | 否，回填给模型修 | schema 校验失败 | 模型（不进用户视野） |
| `budget` | 超出步数/成本/时间 | 否 | 预算边界 | 用户，保留已做进度 |

`isRetryable(category)` 只有 `category === "transient"` 返回 true。

## 三条配套规则

### 1. 只在边界处重试

provider 层重试 HTTP，registry 层重试工具 handler。业务编排层不再包一层重试，否则会形成“重试套重试”，实际请求数变成 N 的平方。

### 2. 重试必须有上限、指数退避和抖动

`withRetry` 使用 `maxRetries`、`baseMs`、`maxMs` 三个硬上限，并在每次等待中加入 `Math.random` 抖动：

```text
delay = min(maxMs, baseMs * 2^attempt) * (0.5 + random * 0.5)
```

没有上限会烧钱；没有抖动会让大量客户端在同一毫秒再次打满故障服务（thundering herd）。重试耗尽时必须抛出**最后一次的原始错误**，不能吞掉 cause，否则排障时只剩“重试失败”。

### 3. 写操作必须有调用方提供的幂等键

超时并不等于没发生。写请求可能已经在服务端成功，只是响应丢了；如果没有幂等键，自动重试就可能建出第二张工单。因此：

- `create_ticket` 标记 `isWrite: true`；
- `registry.execute()` 在执行 handler **之前**检查 `ctx.idempotencyKey`，缺失直接返回 `policy`；
- handler 用 `tenantId + idempotencyKey` 作为幂等表 key，重放返回同一个 `ticketId`；
- 幂等键来自 HTTP 请求 ID 或用户操作 ID，**不能让模型自己生成**，否则每次都是新 key，等于没有幂等。

## 后果

好处是一次 429 不会打断任务，参数错误会以可读 observation 回填给模型，写操作重试也安全。代价是 `categorize()` 对未知错误会保守落到 `permanent`（宁可少重试，不可多花钱），并且团队必须通过 code review 阻止 `throw new Error()` 绕过分类。

## 备选方案

- 只看 HTTP 状态码：覆盖不了工具内部错误；
- 只做字符串匹配：供应商改文案就失效；
- 所有错误重试三次：参数错误浪费 token，写操作有重复副作用风险。

具体实现见 `src/llm/provider.ts` 的 `withRetry`、`src/tools/registry.ts` 的写操作检查，以及 `src/core/errors.ts` 的 `categorize`。
