"""模型提供方：把"调模型"收敛成一个接口，才能在 P0 里做多模型对比与失败降级。

三个实现：
- MockProvider：脚本驱动，**零成本、完全可复现**，用来写 demo 与评测；
- OpenAICompatProvider：用标准库 urllib 调任何 OpenAI 兼容接口（DeepSeek / 千问 / MiniMax / OpenAI）；
- with_retry：只在边界做重试（指数退避 + 抖动 + 上限），失败抛出分类异常。

面试点：模型调用失败不是"再试一次"这么简单——要区分 429/5xx（可重试）、
401/400（不可重试，配置或参数错了）、超时（不可重试但结果未知，写操作要按幂等键处理）。
"""

from __future__ import annotations

import json
import os
import random
import time
import urllib.error
import urllib.request
from typing import Any, Callable, TypeVar

from core.errors import PERMANENT, TIMEOUT, TRANSIENT, AppError, categorize, is_retryable
from core.types import LLMRequest, LLMResponse, Message, ToolCall, Usage

T = TypeVar("T")

# 价格（美元 / 百万 token）。**会变，按你实际账单改这里**，它是成本实验的唯一入口。
DEFAULT_PRICES: dict[str, tuple[float, float]] = {
    "deepseek-chat": (0.27, 1.10),
    "qwen-plus": (0.40, 1.20),
    "minimax-abab6.5": (0.35, 1.40),
    "gpt-4o-mini": (0.15, 0.60),
}


def estimate_cost(model: str, usage: Usage) -> float:
    price_in, price_out = DEFAULT_PRICES.get(model, (0.0, 0.0))
    return (usage.prompt_tokens * price_in + usage.completion_tokens * price_out) / 1_000_000


# ---------------------------------------------------------------- 重试边界

def with_retry(fn: Callable[[], T], *, attempts: int = 3, base_delay: float = 0.4) -> T:
    """只在**可重试**错误上退避重试。不可重试的错误立刻抛，别把 401 重试三次。"""
    last: BaseException | None = None
    for i in range(attempts):
        try:
            return fn()
        except BaseException as exc:  # noqa: BLE001 - 这里就是要兜住一切再分类
            kind = categorize(exc)
            last = exc
            if not is_retryable(kind) or i == attempts - 1:
                raise
            delay = base_delay * (2 ** i) * (0.5 + random.random())  # 抖动：防重试风暴同步
            time.sleep(delay)
    raise last  # pragma: no cover


# ---------------------------------------------------------------- Mock

class MockProvider:
    """脚本驱动的假模型：给定一串 step，按顺序产出响应。

    step 形态：
      {"text": "最终回答"}                      -> 结束
      {"tool": "calculator", "args": {...}}      -> 请求调一次工具
      {"tools": [{"name": ..., "args": ...}]}    -> 一次请求多个工具
    带 "fail": "transient" 的 step 会先抛错，用来演示重试。
    """

    def __init__(self, steps: list[dict[str, Any]], model: str = "mock-model"):
        self.model = model
        self._steps = list(steps)
        self._i = 0
        self.calls = 0

    def generate(self, req: LLMRequest) -> LLMResponse:
        self.calls += 1
        if self._i >= len(self._steps):
            return LLMResponse(content="（脚本已用尽）", usage=Usage(1, 1, 0.0))
        step = self._steps[self._i]
        self._i += 1

        fail = step.get("fail")
        if fail:
            raise AppError(TIMEOUT if fail == "timeout" else TRANSIENT, f"mock {fail} 失败")

        prompt_chars = sum(len(m.content) for m in req.messages)
        usage = Usage(prompt_tokens=prompt_chars // 4 + 1, completion_tokens=12, cost_usd=0.0)

        if "tool" in step:
            call = ToolCall(id=f"call_{self.calls}", name=step["tool"], args=step.get("args", {}))
            return LLMResponse(tool_calls=[call], usage=usage, stop_reason="tool_calls")
        if "tools" in step:
            calls = [
                ToolCall(id=f"call_{self.calls}_{j}", name=t["name"], args=t.get("args", {}))
                for j, t in enumerate(step["tools"])
            ]
            return LLMResponse(tool_calls=calls, usage=usage, stop_reason="tool_calls")
        return LLMResponse(content=step.get("text", ""), usage=usage, stop_reason="stop")


# ---------------------------------------------------------------- 真实模型

class OpenAICompatProvider:
    """任何 OpenAI 兼容的 /chat/completions 都能用（DeepSeek / 千问 / MiniMax / OpenAI）。"""

    def __init__(
        self,
        model: str,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 60.0,
    ):
        self.model = model
        self.api_key = api_key or os.environ.get("LLM_API_KEY", "")
        # DeepSeek 默认地址；换别家改这里或传参
        self.base_url = (base_url or os.environ.get("LLM_BASE_URL") or "https://api.deepseek.com").rstrip("/")
        self.timeout = timeout

    def _payload(self, req: LLMRequest) -> dict[str, Any]:
        messages = []
        for m in req.messages:
            item: dict[str, Any] = {"role": m.role, "content": m.content}
            if m.tool_calls:
                item["tool_calls"] = [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.name, "arguments": json.dumps(c.args, ensure_ascii=False)},
                    }
                    for c in m.tool_calls
                ]
            if m.tool_call_id:
                item["tool_call_id"] = m.tool_call_id
            if m.name:
                item["name"] = m.name
            messages.append(item)

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": req.temperature,
            "max_tokens": req.max_tokens,
        }
        if req.tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                k: {
                                    "type": v.type,
                                    "description": v.description,
                                    **({"enum": v.enum} if v.enum else {}),
                                }
                                for k, v in t.params.items()
                            },
                            "required": [k for k, v in t.params.items() if v.required],
                        },
                    },
                }
                for t in req.tools
            ]
        return payload

    def generate(self, req: LLMRequest) -> LLMResponse:
        payload = self._payload(req)
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")[:300]
            if exc.code in (408, 429) or exc.code >= 500:
                raise AppError(TRANSIENT, f"HTTP {exc.code}: {detail}") from exc
            raise AppError(PERMANENT, f"HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise AppError(TRANSIENT, f"网络错误: {exc.reason}") from exc
        except TimeoutError as exc:
            raise AppError(TIMEOUT, "请求超时（结果未知：写操作请用幂等键）") from exc

        return self._parse(body)

    def _parse(self, body: dict[str, Any]) -> LLMResponse:
        choice = (body.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        usage_raw = body.get("usage") or {}
        usage = Usage(
            prompt_tokens=int(usage_raw.get("prompt_tokens") or 0),
            completion_tokens=int(usage_raw.get("completion_tokens") or 0),
        )
        usage.cost_usd = estimate_cost(self.model, usage)

        calls: list[ToolCall] = []
        for i, t in enumerate(msg.get("tool_calls") or []):
            fn = t.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                # 参数非法 JSON 是**高频真实故障**（P1）：把原文带回给模型让它重发
                args = {"__raw_arguments__": fn.get("arguments") or ""}
            calls.append(ToolCall(id=t.get("id") or f"call_{i}", name=fn.get("name") or "", args=args))

        return LLMResponse(
            content=msg.get("content") or "",
            tool_calls=calls,
            usage=usage,
            stop_reason="tool_calls" if calls else (choice.get("finish_reason") or "stop"),
        )


def build_messages(system: str, user: str) -> list[Message]:
    return [Message(role="system", content=system), Message(role="user", content=user)]
