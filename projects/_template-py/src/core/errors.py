"""错误分类：决定"重试 / 回填 / 上报 / 终止"的唯一依据。

三条规则（面试可以直接背）：
1. 只有 transient（网络、429、5xx、超时）可以重试，且必须有上限 + 退避；
2. validation（参数不合法）**不重试**，把错误信息回填给模型让它自己改；
3. policy（权限、确认、幂等键缺失）既不重试也不回填重试，直接终止并给用户可读理由。
"""

from __future__ import annotations

from typing import Any

VALIDATION = "validation"
POLICY = "policy"
TRANSIENT = "transient"
PERMANENT = "permanent"
BUDGET = "budget"
TIMEOUT = "timeout"
LOOP = "loop"

ALL_KINDS = (VALIDATION, POLICY, TRANSIENT, PERMANENT, BUDGET, TIMEOUT, LOOP)


class AppError(Exception):
    """带分类的应用异常。工具层可以抛，registry 会在边界统一转成 ToolResult。"""

    def __init__(self, kind: str, message: str, *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.kind = kind if kind in ALL_KINDS else PERMANENT
        self.message = message
        self.details = details or {}


class BudgetExceeded(AppError):
    def __init__(self, message: str):
        super().__init__(BUDGET, message)


def categorize(exc: BaseException) -> str:
    """把任意异常映射成 7 类之一。未知异常一律 permanent——宁可停，不要瞎重试。"""
    if isinstance(exc, AppError):
        return exc.kind
    name = type(exc).__name__.lower()
    if isinstance(exc, (TimeoutError,)):
        return TIMEOUT
    if "timeout" in name or "timedout" in name:
        return TIMEOUT
    if "connection" in name or "urlerror" in name:
        return TRANSIENT
    return PERMANENT


def is_retryable(kind: str) -> bool:
    return kind in (TRANSIENT, TIMEOUT)
