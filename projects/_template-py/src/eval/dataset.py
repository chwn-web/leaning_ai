"""评测数据集：一行一个 JSON 用例，**先写用例再写代码**。

字段：
  id              用例编号（稳定，别改，回归靠它）
  input           用户输入
  script          假模型的脚本（ModelProvider 驱动，用来稳定复现）
  expect_contains 期望回答里出现的字符串（happy path 用）
  tags            应拒绝类用例的标签（missing_info / tool_error / policy / no_answer / loop）
  idempotency_key 写操作用例的幂等键（没有就不给写权限，用来验证 policy 拒绝）

真实项目里 script 换成真实模型调用，其余字段一个都不用改。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REFUSAL_TAGS = ("missing_info", "tool_error", "policy", "no_answer")


@dataclass
class Case:
    id: str
    input: str
    script: list[dict[str, Any]] = field(default_factory=list)
    expect_contains: str = ""
    tags: list[str] = field(default_factory=list)
    idempotency_key: str | None = None


def load_cases(path: str | Path) -> list[Case]:
    cases: list[Case] = []
    for line_no, raw in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_no} 不是合法 JSON：{exc}") from exc
        cases.append(
            Case(
                id=data["id"],
                input=data["input"],
                script=data.get("script", []),
                expect_contains=data.get("expect_contains", ""),
                tags=data.get("tags", []),
                idempotency_key=data.get("idempotency_key"),
            )
        )
    return cases
