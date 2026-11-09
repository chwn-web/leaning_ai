"""数据结构：全项目唯一的类型定义，零依赖。

分层原则：core 层不 import 任何业务模块，只被别人 import。
这样就断了循环依赖——面试时可以指着这个文件说"分层不是喊口号，是编译期约束"。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


# ---------------------------------------------------------------- 消息与模型

@dataclass
class ToolCall:
    """模型请求调用一个工具。args 一律视为**不可信输入**。"""

    id: str
    name: str
    args: dict[str, Any] = field(default_factory=dict)


@dataclass
class Message:
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: str | None = None  # role="tool" 时回填，用来对上具体的那一次调用
    name: str | None = None


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def add(self, other: "Usage") -> None:
        self.prompt_tokens += other.prompt_tokens
        self.completion_tokens += other.completion_tokens
        self.cost_usd += other.cost_usd

    def as_dict(self) -> dict[str, Any]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "cost_usd": round(self.cost_usd, 6),
        }


@dataclass
class LLMResponse:
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    stop_reason: str = "stop"  # "stop" | "tool_calls" | "length"

    @property
    def wants_tools(self) -> bool:
        return len(self.tool_calls) > 0


@dataclass
class LLMRequest:
    model: str
    messages: list[Message]
    tools: list["ToolSpec"] = field(default_factory=list)
    temperature: float = 0.0
    max_tokens: int = 1024


# ---------------------------------------------------------------- 工具契约

@dataclass
class ParamSchema:
    type: str  # "string" | "number" | "boolean" | "object" | "array"
    required: bool = False
    description: str = ""
    enum: list[Any] | None = None


@dataclass
class ToolSpec:
    name: str
    description: str
    params: dict[str, ParamSchema] = field(default_factory=dict)
    is_write: bool = False  # 写操作：必须带幂等键，且默认要求人工确认


@dataclass
class ToolContext:
    """一次工具调用的上下文。权限信息**必须**从这里拿，不要让模型自己声明。"""

    tenant_id: str
    requested_by: str
    idempotency_key: str | None = None


@dataclass
class ToolResult:
    """工具永远返回结果对象，**不抛异常**——异常在 registry 边界被吃掉并分类。"""

    ok: bool
    data: Any = None
    error_kind: str | None = None  # 见 core/errors.py
    error_message: str | None = None
    retryable: bool = False

    @classmethod
    def success(cls, data: Any) -> "ToolResult":
        return cls(ok=True, data=data)

    @classmethod
    def failure(cls, kind: str, message: str, retryable: bool = False) -> "ToolResult":
        return cls(ok=False, error_kind=kind, error_message=message, retryable=retryable)

    def as_observation(self) -> str:
        """回填给模型看的文本。失败时也要给**可行动**的信息，否则模型只会瞎猜。"""
        if self.ok:
            return f"ok: {self.data}"
        return f"error[{self.error_kind}]: {self.error_message}"


@dataclass
class ToolDefinition:
    spec: ToolSpec
    handler: Callable[[dict[str, Any], ToolContext], ToolResult]


# ---------------------------------------------------------------- 运行结果

@dataclass
class RunResult:
    status: str  # "done" | "budget" | "loop_detected" | "error"
    answer: str
    steps: int = 0
    usage: Usage = field(default_factory=Usage)
    trace_path: str | None = None
    error_kind: str | None = None
    events: list[str] = field(default_factory=list)
