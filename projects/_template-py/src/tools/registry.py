"""工具注册表：所有工具调用的**唯一入口**，也是错误分类与权限检查的边界。

六件事都在这里做，业务工具只负责"干活"：
1. 未知工具 -> validation 错误（不是崩）；
2. 参数按 schema 校验 -> validation 错误（可回填给模型自修复）；
3. 写操作必须带幂等键 -> 否则 policy 拒绝（防止超时重试导致重复建单）；
4. 执行异常 -> 分类成 7 类之一，转成 ToolResult（工具层不向外抛异常）；
5. transient 错误在本层有限次退避重试（上限 2 次），其它错误一律不重试；
6. 每次调用都测耗时，记录到 trace。
"""

from __future__ import annotations

import time
from typing import Any

from core.errors import PERMANENT, POLICY, TRANSIENT, VALIDATION, categorize, is_retryable
from core.types import ToolContext, ToolDefinition, ToolResult, ToolSpec
from core.validate import validate_args

MAX_TRANSIENT_RETRIES = 2
RETRY_BACKOFF = 0.05


class ToolRegistry:
    def __init__(self, tools: list[ToolDefinition], *, call_log: list[dict[str, Any]] | None = None):
        self._tools: dict[str, ToolDefinition] = {t.spec.name: t for t in tools}
        self.call_log = call_log if call_log is not None else []

    # ------------------------------------------------------------ 只读视图

    def specs(self) -> list[ToolSpec]:
        return [t.spec for t in self._tools.values()]

    def names(self) -> list[str]:
        return list(self._tools)

    # ------------------------------------------------------------ 唯一入口

    def call(self, name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        started = time.time()
        result = self._call_inner(name, args, ctx)
        self.call_log.append(
            {
                "tool": name,
                "args": args,
                "ok": result.ok,
                "error_kind": result.error_kind,
                "duration_ms": round((time.time() - started) * 1000, 2),
            }
        )
        return result

    def _call_inner(self, name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult.failure(VALIDATION, f"未注册的工具 `{name}`，可用工具：{self.names()}")

        errors = validate_args(tool.spec.params, args)
        if errors:
            return ToolResult.failure(VALIDATION, "参数校验失败：" + "；".join(errors))

        if tool.spec.is_write and not ctx.idempotency_key:
            return ToolResult.failure(
                POLICY, f"`{name}` 是写操作，必须携带幂等键才能执行（防止重试导致重复写入）"
            )

        attempt = 0
        while True:
            try:
                result = tool.handler(args, ctx)
            except BaseException as exc:  # noqa: BLE001 - 边界统一分类，工具实现可以随便抛
                kind = categorize(exc)
                result = ToolResult.failure(kind, f"{type(exc).__name__}: {exc}", retryable=is_retryable(kind))

            if result.ok or not result.retryable or attempt >= MAX_TRANSIENT_RETRIES:
                return result
            attempt += 1
            time.sleep(RETRY_BACKOFF * (2 ** (attempt - 1)))
