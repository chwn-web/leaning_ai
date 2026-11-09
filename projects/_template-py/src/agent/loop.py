"""Agent 循环：整个骨架的心脏，只有 ~100 行，但每个分支都对应一类真实故障。

面试时这一段要能默写出来。它回答的问题是：
"模型说要调工具，然后呢？模型一直调同一个工具怎么办？模型不调了算成功吗？"

关键设计（每一条都能被追问）：
1. **预算是前置检查**：调用模型前就检查步数/花费/墙钟，不是跑完再算账；
2. **动作签名判重**：同 (工具, 参数) 第 3 次出现 -> 判定 loop_detected，终止并上报；
3. **工具结果永远以观察文本回填**：失败也要回填可行动的错误，模型才知道改；
4. **终止条件是模型不再要工具**：不是"step 用尽"——step 用尽是失败，不是完成。
"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from core.budget import Budget
from core.errors import BUDGET, LOOP, BudgetExceeded, categorize
from core.types import LLMRequest, Message, RunResult, Usage
from obs.tracer import Tracer
from tools.registry import ToolRegistry

SYSTEM_PROMPT = (
    "你是一个谨慎的内部助手。需要计算就用 calculator，不要心算；"
    "需要制度信息就用 search_docs，并引用 doc_id；"
    "写操作（create_ticket）必须先得到用户明确确认。"
    "信息不足时直接向用户提问，不要编造。"
)

MAX_TOOL_CALLS_PER_STEP = 4
LOOP_THRESHOLD = 3  # 同一动作出现第 3 次即判定死循环


def action_signature(name: str, args: dict[str, Any]) -> str:
    """稳定的动作指纹：参数排序后序列化，避免 {'a':1,'b':2} 与 {'b':2,'a':1} 被当成两个动作。"""
    return name + "|" + json.dumps(args, ensure_ascii=False, sort_keys=True, default=str)


def run_agent(
    provider: Any,
    registry: ToolRegistry,
    messages: list[Message],
    ctx: Any,
    *,
    budget: Budget | None = None,
    tracer: Tracer | None = None,
    model: str = "mock-model",
    max_tool_calls_per_step: int = MAX_TOOL_CALLS_PER_STEP,
) -> RunResult:
    budget = budget or Budget()
    tracer = tracer or Tracer()
    usage = Usage()
    signatures: Counter[str] = Counter()
    events: list[str] = []
    msgs = list(messages)

    try:
        for step in range(1, budget.max_steps + 1):
            budget.check_step()
            budget.check_before_call()

            with tracer.span("llm", step=step, model=model) as span:
                resp = provider.generate(
                    LLMRequest(model=model, messages=msgs, tools=registry.specs())
                )
                span["prompt_tokens"] = resp.usage.prompt_tokens
            budget.charge(resp.usage)
            usage.add(resp.usage)

            if not resp.wants_tools:
                events.append(f"第 {step} 步：模型给出最终回答")
                return RunResult(
                    status="done",
                    answer=resp.content,
                    steps=step,
                    usage=usage,
                    trace_path=tracer.path,
                    events=events,
                )

            calls = resp.tool_calls
            if len(calls) > max_tool_calls_per_step:
                events.append(
                    f"第 {step} 步：模型一次要了 {len(calls)} 个工具，超过上限 {max_tool_calls_per_step}，只执行前 {max_tool_calls_per_step} 个"
                )
                calls = calls[:max_tool_calls_per_step]

            msgs.append(Message(role="assistant", content=resp.content, tool_calls=calls))

            for call in calls:
                sig = action_signature(call.name, call.args)
                signatures[sig] += 1
                if signatures[sig] >= LOOP_THRESHOLD:
                    events.append(f"第 {step} 步：动作 `{call.name}` 第 {signatures[sig]} 次重复，判定死循环")
                    return RunResult(
                        status="loop_detected",
                        answer=f"我连续 {signatures[sig]} 次尝试同一个动作（{call.name}），已停止以免空转。请换个思路或补充信息。",
                        steps=step,
                        usage=usage,
                        trace_path=tracer.path,
                        error_kind=LOOP,
                        events=events,
                    )

                with tracer.span("tool", step=step, tool=call.name) as span:
                    result = registry.call(call.name, call.args, ctx)
                    span["ok"] = result.ok
                    span["error_kind"] = result.error_kind

                preview = ""
                if result.ok:
                    raw = json.dumps(result.data, ensure_ascii=False, default=str)
                    preview = " " + (raw[:90] + "…" if len(raw) > 90 else raw)
                events.append(
                    f"第 {step} 步：调 {call.name}({json.dumps(call.args, ensure_ascii=False)}) -> "
                    + ("ok" if result.ok else f"error[{result.error_kind}]")
                    + preview
                )
                msgs.append(
                    Message(
                        role="tool",
                        content=result.as_observation(),
                        tool_call_id=call.id,
                        name=call.name,
                    )
                )

        events.append(f"步数用尽（{budget.max_steps}），任务未完成")
        return RunResult(
            status="budget",
            answer="步数预算用尽，任务未完成。已保留中间结果与 trace，可续跑或缩小任务范围。",
            steps=budget.max_steps,
            usage=usage,
            trace_path=tracer.path,
            error_kind=BUDGET,
            events=events,
        )

    except BudgetExceeded as exc:
        events.append(f"预算终止：{exc.message}")
        return RunResult(
            status="budget",
            answer=f"已停止：{exc.message}",
            steps=budget.steps,
            usage=usage,
            trace_path=tracer.path,
            error_kind=BUDGET,
            events=events,
        )
    except BaseException as exc:  # noqa: BLE001
        events.append(f"未预期异常：{type(exc).__name__}: {exc}")
        return RunResult(
            status="error",
            answer=f"内部错误：{exc}",
            steps=budget.steps,
            usage=usage,
            trace_path=tracer.path,
            error_kind=categorize(exc),
            events=events,
        )
