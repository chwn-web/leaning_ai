# _template-py · 零依赖 Python Agent 骨架

> 这是你 **P0–P4 所有项目**的起点。先跑通，再改 3 个文件，不要从零搭。
>
> ```powershell
> cd projects/_template-py
> python src/main.py          # 看 8 个场景：正常链路 / 参数自修复 / 死循环熔断 / 写操作拦截 / 幂等重放 / 预算终止 / 工具报错
> python src/eval/run.py --k 3 # 看评测：11 条用例、pass@k、pass^k、95% CI、样本量警告
> ```
> 需要 Python 3.11+。**不需要 pip install 任何东西**。

## 为什么零依赖

| 依赖 | 为什么不用 | 用什么替代 |
|---|---|---|
| LangChain / LangGraph | 初期你会把"框架做了什么"和"Agent 该做什么"混在一起，排障时找不到边界 | 100 行手写 `agent/loop.py` |
| pydantic / jsonschema | 校验只有 40 行，自己写一遍才知道"模型给的参数该怎么防" | `core/validate.py` |
| openai SDK | 只用到 `/chat/completions` 一个接口，`urllib` 足够，还能看清 HTTP 层错误码 | `llm/provider.py` |
| pytest | 骨架自带评测器，比单测更贴 Agent 的验收方式 | `eval/runner.py` |
| loguru / structlog | 一行 JSON 就够，落盘后能用任何工具读 | `obs/tracer.py` |

**这不代表生产不用框架**——W8 你会对比 LangGraph 等，再决定用哪个。但那时你已经有"没有框架也能跑"的基线，才判断得出框架值不值。

## 目录 → 七层映射

| 目录 / 文件 | 行数 | 对应层 | 职责 |
|---|---|---|---|
| `src/main.py` | ~250 | L6 入口 | 场景编排、打印人能看懂的过程 |
| `src/agent/loop.py` | ~180 | L5 编排 | 循环、动作签名判重、预算前置检查、终止条件 |
| `src/core/types.py` | ~150 | L0 契约 | 唯一类型定义，零依赖（断循环依赖） |
| `src/core/errors.py` | ~70 | L0 横切 | 7 类错误 + "哪些可重试" |
| `src/core/budget.py` | ~70 | L0 横切 | 步数 / 花费 / 墙钟三重预算 |
| `src/core/validate.py` | ~60 | L2 边界 | 工具参数 schema 校验 |
| `src/llm/provider.py` | ~250 | L3 模型 | Mock（脚本驱动）+ OpenAI 兼容 + 重试边界 + 成本估算 |
| `src/tools/registry.py` | ~100 | L2 工具 | 唯一入口：校验、幂等、异常分类、有限重试、耗时 |
| `src/tools/builtin.py` | ~230 | L2 工具 | 三个示范工具（计算 / 检索 / 写操作） |
| `src/obs/tracer.py` | ~70 | L0 横切 | JSONL trace + summary |
| `src/eval/*` | ~220 | L0 评测 | 数据集、判定器、pass@k/pass^k/CI |
| `data/golden.jsonl` | 11 条 | — | 用例：4 类"应该拒绝"的样本都覆盖了 |

**依赖方向只有一个**：L6 → L5 → L4 → L3 → L2 → L1，L0 横切。`core/types.py` 不 import 任何业务模块，所以永远不会出现循环依赖。ADR 见 [`docs/adr/0001-python-mainline.md`](docs/adr/0001-python-mainline.md)。

## 五个关键设计决定（面试会被追问的地方）

1. **工具失败返回结果对象，不抛异常**
   `tools/registry.py` 是唯一能捕获异常的地方，它在边界把异常分类成 7 类并转成 `ToolResult(ok=False, error_kind=...)`。好处：模型看到的是**可行动的错误文本**（"缺少必填参数 expression"），能自我修复；调用方永远不用写 `try/except`。
2. **幂等键必须由调用方传，不能由模型生成**
   模型生成的是"内容哈希"，同一意图两次会得到不同值——那就不叫幂等。`create_ticket` 因此是 `is_write=True`，且 registry 在缺幂等键时直接 `policy` 拒绝。这是"超时≠没发生"的唯一解法。
3. **权限过滤在打分之前**
   `search_docs` 先按 `tenant_id` 过滤再算分。反过来（先取 top3 再过滤）会出现"检索到 3 条、过滤后 0 条"，用户看到"没找到"但其实是他没权限——这个坑在 P2 里会正式踩一遍。
4. **动作签名判重，不是"步数上限"**
   同一 `(工具, 排序后的参数)` 第 3 次出现 → `loop_detected`。只靠步数上限会让 agent 烧完 8 步才停，钱已经花了。
5. **预算检查在调用模型之前**
   `budget.check_step()` / `check_before_call()` 都在 `provider.generate()` 之前。事后算账只能报警，不能止损。

## 用三步开一个新项目

```powershell
Copy-Item -Recurse projects/_template-py projects/p1-tool-agent
cd projects/p1-tool-agent
# 1) 改 src/tools/builtin.py  → 这个项目的真实工具（其余骨架不动）
# 2) 改 src/main.py            → 真实业务流程（替换 8 个 demo 场景）
# 3) 改 data/golden.jsonl      → 30+ 条真实用例（先写用例，再写实现）
python src/eval/run.py --k 3   # 每次改完都跑
```

**什么时候允许改 `agent/loop.py`？** 只有当"业务需要一种新的终止条件"（比如人工审批中断、外部事件恢复）时才改。如果只是因为"业务逻辑放不下"，那是你把编排层和业务层混了。

## 故意没做（面试被问"为什么不做"就照这个答）

| 没做 | 为什么 | 什么时候补 |
|---|---|---|
| 工具执行硬超时 | Python 里杀线程不安全，正确做法是子进程 + kill，属基础设施活 | W9（沙箱与超时） |
| 真实模型的流式输出 | 骨架演示的是控制流，流式和工具调用的冲突是独立课题 | W5（会踩 P9 那个坑） |
| 长期记忆 / 向量库 | 现在只需要"能跑通"，过早引入会掩盖主流程 | W10–W11 |
| 并发与限流 | 先证明单条链路对，再谈吞吐 | W17–W18 |
| 提示注入防护 | 演示工具需要先有"不可信内容"这个前提 | W22（lethal trifecta） |

## 建议阅读顺序（1 小时）

1. `src/core/types.py` — 数据结构就是架构
2. `src/agent/loop.py` — 心脏，要能默写
3. `src/tools/registry.py` — 所有"防模型"的事都在这
4. `src/tools/builtin.py` — 三个工具示范三类问题
5. `src/eval/runner.py` — 判定器比模型更能决定你项目的可信度

## 验收清单（跑完两条命令后自检）

- [ ] `python src/main.py` 8 个场景都符合"预期"那一行
- [ ] `python src/eval/run.py --k 3` 显示 11/11 且给出样本量警告
- [ ] 能指出"幂等键在哪一行被检查"（`tools/registry.py`）
- [ ] 能解释为什么 `case-008` 判过而 `case-007` 也判过，两者差别在哪儿
- [ ] 能说出 `loop_detected` 与 `budget` 两个终止状态的业务差别
- [ ] 能讲清"同一份用例，pass@k 和 pass^k 分别回答什么问题"
- [ ] 能把 `data/golden.jsonl` 的数字改大，验证 CI 变窄（n=100 时约 ±8 分）
