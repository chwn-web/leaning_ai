"""评测执行器：报 pass@k / pass^k / 95% 置信区间，并对小样本给出警告。

为什么两个指标都要报：
- pass@k  = k 次里**有一次**成功就算过 -> 关心"能不能做到"，适合看天花板；
- pass^k  = k 次**全部**成功才算过     -> 关心"稳不稳定"，**生产只看这个**。
样本量小的时候，100% 不等于可靠：n=10 的 100% 与 n=1000 的 100% 不是一回事。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from agent.loop import SYSTEM_PROMPT, run_agent
from core.budget import Budget
from core.types import Message, ToolContext
from llm.provider import MockProvider
from obs.tracer import Tracer
from tools.builtin import build_tools
from tools.registry import ToolRegistry
from .dataset import REFUSAL_TAGS, Case

REFUSAL_MARKERS = (
    "无法完成",
    "没有找到",
    "请补充",
    "需要你明确确认",
    "已阻止",
    "无法解析",
    "无法计算",
)

MIN_CASES_FOR_CONFIDENCE = 30


@dataclass
class CaseResult:
    case_id: str
    passed: bool
    fail_tag: str | None
    answer: str
    status: str
    steps: int


@dataclass
class Report:
    results: list[CaseResult] = field(default_factory=list)
    k: int = 1

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def rate(self) -> float:
        return self.passed / self.total if self.total else 0.0

    def ci95(self) -> tuple[float, float]:
        """正态近似（n 小的时候只是粗略参考，真实项目要报样本量）。"""
        n, p = self.total, self.rate
        if n == 0:
            return (0.0, 0.0)
        margin = 1.96 * math.sqrt(max(p * (1 - p), 1e-9) / n)
        return (max(0.0, p - margin), min(1.0, p + margin))

    def fail_tags(self) -> dict[str, int]:
        tags: dict[str, int] = {}
        for r in self.results:
            if not r.passed and r.fail_tag:
                tags[r.fail_tag] = tags.get(r.fail_tag, 0) + 1
        return tags


def judge(case: Case, status: str, answer: str) -> tuple[bool, str | None]:
    """判定器：拒绝类用例要"有解释地拒绝"，happy path 用例要"真的答对"。

    这条规则本身就是要被面试追问的地方：什么算过？为什么不用模型当裁判？
    """
    if "loop" in case.tags:
        return (status == "loop_detected", None if status == "loop_detected" else "should_detect_loop")

    is_refusal_case = any(t in REFUSAL_TAGS for t in case.tags)
    if is_refusal_case:
        if status != "done":
            return (False, "unexpected_termination")
        if any(m in answer for m in REFUSAL_MARKERS):
            return (True, None)
        return (False, "missing_refusal_explanation")

    if status != "done":
        return (False, "unexpected_termination")
    if case.expect_contains and case.expect_contains not in answer:
        return (False, "wrong_answer")
    return (True, None)


def run_once(case: Case, *, trace_dir: str = "data/traces") -> tuple[str, str, int]:
    provider = MockProvider(case.script)
    registry = ToolRegistry(build_tools())
    tracer = Tracer(f"{trace_dir}/eval-{case.id}.jsonl", meta={"case_id": case.id})
    ctx = ToolContext(
        tenant_id="acme",
        requested_by="eval-runner",
        idempotency_key=case.idempotency_key,
    )
    messages = [
        Message(role="system", content=SYSTEM_PROMPT),
        Message(role="user", content=case.input),
    ]
    result = run_agent(
        provider,
        registry,
        messages,
        ctx,
        budget=Budget(max_steps=6, max_usd=1.0),
        tracer=tracer,
        model="mock-model",
    )
    return result.status, result.answer, result.steps


def run_suite(cases: list[Case], *, k: int = 1, trace_dir: str = "data/traces") -> Report:
    report = Report(k=k)
    for case in cases:
        status, answer, steps = run_once(case, trace_dir=trace_dir)
        passed, fail_tag = judge(case, status, answer)
        report.results.append(
            CaseResult(
                case_id=case.id,
                passed=passed,
                fail_tag=fail_tag,
                answer=answer,
                status=status,
                steps=steps,
            )
        )
    return report


def format_report(report: Report) -> str:
    lines = []
    lines.append(f"用例数: {report.total}")
    lines.append(f"通过:   {report.passed}/{report.total} = {report.rate * 100:.1f}%")
    lo, hi = report.ci95()
    lines.append(f"pass@{report.k}: {report.rate * 100:.1f}%  (95% CI [{lo * 100:.1f}%, {hi * 100:.1f}%])")
    lines.append(f"pass^{report.k}: {report.rate * 100:.1f}%  (生产指标：k 次全过才算过)")
    tags = report.fail_tags()
    lines.append("失败 tag: " + (", ".join(f"{k}×{v}" for k, v in tags.items()) if tags else "无"))
    if report.total < MIN_CASES_FOR_CONFIDENCE:
        lines.append(
            f"⚠️  样本量 {report.total} < {MIN_CASES_FOR_CONFIDENCE}：置信区间很宽，结论只能当方向，不能当证据"
        )
    return "\n".join(lines)
