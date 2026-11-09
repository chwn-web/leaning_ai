"""预算守卫：步数、花费、墙钟时间。**在调用模型之前检查**，不是之后。"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from .errors import BudgetExceeded
from .types import Usage


@dataclass
class Budget:
    max_steps: int = 8
    max_usd: float = 0.05
    max_wall_seconds: float = 120.0

    spent: Usage = field(default_factory=Usage)
    steps: int = 0
    _started_at: float = field(default_factory=time.time)

    # ------------------------------------------------------------ 检查点

    def check_step(self) -> None:
        """每一步开始前调用。超了就直接终止，别让模型再"努力一次"。"""
        if self.steps >= self.max_steps:
            raise BudgetExceeded(f"步数用尽：{self.steps}/{self.max_steps}")
        self.steps += 1

    def check_before_call(self, estimated_usd: float = 0.0) -> None:
        if self.spent.cost_usd + estimated_usd > self.max_usd:
            raise BudgetExceeded(
                f"花费超限：已用 ${self.spent.cost_usd:.6f}，上限 ${self.max_usd:.2f}"
            )
        self.check_wall_clock()

    def check_wall_clock(self) -> None:
        elapsed = time.time() - self._started_at
        if elapsed > self.max_wall_seconds:
            raise BudgetExceeded(f"超时：{elapsed:.1f}s > {self.max_wall_seconds:.0f}s")

    # ------------------------------------------------------------ 记账

    def charge(self, usage: Usage) -> None:
        self.spent.add(usage)

    def snapshot(self) -> dict[str, object]:
        return {
            "steps": self.steps,
            "max_steps": self.max_steps,
            "elapsed_s": round(time.time() - self._started_at, 2),
            "prompt_tokens": self.spent.prompt_tokens,
            "completion_tokens": self.spent.completion_tokens,
            "cost_usd": round(self.spent.cost_usd, 6),
            "max_usd": self.max_usd,
        }
