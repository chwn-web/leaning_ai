"""骨架自检入口：python src/main.py

跑 7 个场景，每个场景演示一类真实故障的处理方式。**先跑这个，再改代码。**
看到的不应该是"hello world"，而是：
  正常链路 / 参数自修复 / 死循环熔断 / 写操作被拦 / 幂等重放 / 预算终止 / 工具报错
"""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from agent.loop import SYSTEM_PROMPT, run_agent
from core.budget import Budget
from core.types import Message, ToolContext
from llm.provider import MockProvider
from obs.tracer import Tracer
from tools.builtin import build_tools
from tools.registry import ToolRegistry

DIVIDER = "=" * 78


def show(title: str, question: str, expect: str, result, tracer: Tracer) -> None:
    print(f"\n{DIVIDER}\n【{title}】\n{DIVIDER}")
    print(f"问题　　: {question}")
    print(f"预期　　: {expect}")
    print(f"实际状态: {result.status}  (steps={result.steps})")
    print(f"最终回答: {result.answer}")
    if result.events:
        print("执行轨迹:")
        for e in result.events:
            print(f"  - {e}")
    snap = result.usage.as_dict()
    print(f"成本　　: prompt={snap['prompt_tokens']} completion={snap['completion_tokens']} cost=${snap['cost_usd']}")
    print(f"trace　 : {tracer.path}")


def scenario(
    title: str,
    question: str,
    expect: str,
    script: list,
    *,
    budget: Budget | None = None,
    idempotency_key: str | None = None,
) -> object:
    tracer = Tracer(meta={"scenario": title})
    provider = MockProvider(script)
    registry = ToolRegistry(build_tools())
    ctx = ToolContext(tenant_id="acme", requested_by="demo-user", idempotency_key=idempotency_key)
    messages = [Message(role="system", content=SYSTEM_PROMPT), Message(role="user", content=question)]
    result = run_agent(
        provider,
        registry,
        messages,
        ctx,
        budget=budget or Budget(),
        tracer=tracer,
        model="mock-model",
    )
    show(title, question, expect, result, tracer)
    return result


def main() -> int:
    print(DIVIDER)
    print("零依赖 Agent 骨架自检（Python 版）")
    print(DIVIDER)

    summary: list[tuple[str, str, int, float]] = []

    # ① 正常两跳：模型要工具 -> 拿到结果 -> 给最终答案
    r = scenario(
        "S1 正常链路（模型主动调工具）",
        "2 + 3 * 4 等于多少？",
        "调一次 calculator，得到 14，然后给最终答案",
        [
            {"tool": "calculator", "args": {"expression": "2 + 3 * 4"}},
            {"text": "结果是 14。"},
        ],
    )
    summary.append(("S1 正常链路", r.status, r.steps, r.usage.cost_usd))

    # ② 参数缺失 -> 校验失败 -> 错误回填 -> 模型自我修复
    r = scenario(
        "S2 参数缺失后的自我修复",
        "帮我算一下 6 乘以 8",
        "第一次调用缺 expression 被校验拦下，模型看到可行动的错误后自己补上，得到 48",
        [
            {"tool": "calculator", "args": {}},
            {"tool": "calculator", "args": {"expression": "6 * 8"}},
            {"text": "结果是 48。"},
        ],
    )
    summary.append(("S2 参数自修复", r.status, r.steps, r.usage.cost_usd))

    # ③ 同一动作第 3 次 -> 熔断（否则就是烧钱的死循环）
    r = scenario(
        "S3 死循环熔断",
        "算一下 1+1",
        "同一个 (工具, 参数) 第 3 次出现即终止，返回 loop_detected",
        [
            {"tool": "calculator", "args": {"expression": "1+1"}},
            {"tool": "calculator", "args": {"expression": "1+1"}},
            {"tool": "calculator", "args": {"expression": "1+1"}},
        ],
    )
    summary.append(("S3 死循环熔断", r.status, r.steps, r.usage.cost_usd))

    # ④ 写操作没有幂等键 -> policy 直接拒绝（注意：这不是重试能解决的）
    r = scenario(
        "S4a 写操作缺幂等键被拦住",
        "帮我提个工单：3 楼打印机坏了",
        "registry 判定 policy 错误，不执行写操作",
        [
            {"tool": "create_ticket", "args": {"title": "打印机坏了", "body": "3 楼打印机无法打印", "confirm": True}},
            {"text": "工单创建被阻止了（缺少幂等键）。写操作必须走正式入口重试。"},
        ],
        idempotency_key=None,
    )
    summary.append(("S4a 缺幂等键拦截", r.status, r.steps, r.usage.cost_usd))

    # ⑤ 带幂等键 -> 正常创建
    r = scenario(
        "S4b 带幂等键正常创建",
        "帮我提个工单：3 楼打印机坏了",
        "创建成功，返回 TICKET-xxxx",
        [
            {"tool": "create_ticket", "args": {"title": "打印机坏了", "body": "3 楼打印机无法打印", "confirm": True}},
            {"text": "已创建。"},
        ],
        idempotency_key="demo-key-printer",
    )
    summary.append(("S4b 正常建单", r.status, r.steps, r.usage.cost_usd))

    # ⑥ 同一幂等键重放 -> 返回同一张工单，不重复创建
    r = scenario(
        "S4c 同幂等键重放（超时重试的真实场景）",
        "再试一次刚才那张工单",
        "返回同一张工单并标记 idempotent_replay，不会建第二张",
        [
            {"tool": "create_ticket", "args": {"title": "打印机坏了", "body": "3 楼打印机无法打印", "confirm": True}},
            {"text": "这张工单已经创建过了（重复请求已合并）。"},
        ],
        idempotency_key="demo-key-printer",
    )
    summary.append(("S4c 幂等重放", r.status, r.steps, r.usage.cost_usd))

    # ⑦ 预算终止：步数不够时必须停下并说明，而不是"再努力一次"
    r = scenario(
        "S5 预算终止（步数用尽）",
        "帮我查差旅标准并提个工单",
        "maxSteps=2 时在预算边界停止，返回 status=budget",
        [
            {"tool": "search_docs", "args": {"query": "差旅 报销 标准"}},
            {"tool": "search_docs", "args": {"query": "差旅 报销 住宿"}},
            {"tool": "create_ticket", "args": {"title": "报销咨询", "body": "员工咨询差旅住宿标准", "confirm": True}},
            {"text": "已完成。"},
        ],
        budget=Budget(max_steps=2, max_usd=1.0),
        idempotency_key="demo-key-steps",
    )
    summary.append(("S5 预算终止", r.status, r.steps, r.usage.cost_usd))

    # ⑧ 工具自身报错：模型必须承认失败，不许编造结果
    r = scenario(
        "S6 工具报错不许编造",
        "请计算 2 + * 3",
        "calculator 返回校验错误，模型如实说明而不是瞎给一个数",
        [
            {"tool": "calculator", "args": {"expression": "2 + * 3"}},
            {"text": "这个表达式无法解析，请检查运算符后重发。"},
        ],
    )
    summary.append(("S6 工具报错", r.status, r.steps, r.usage.cost_usd))

    print(f"\n{DIVIDER}\n汇总\n{DIVIDER}")
    print(f"{'场景':<22}{'状态':<16}{'步数':<6}成本")
    for name, status, steps, cost in summary:
        print(f"{name:<22}{status:<16}{steps:<6}${cost:.6f}")
    print(DIVIDER)
    print("下一步：把 data/golden.jsonl 当模板写你自己的 30+ 条用例，然后改 tools/builtin.py。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
