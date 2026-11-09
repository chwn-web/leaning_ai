"""内置工具：三个 demo 工具，分别演示三类工具设计问题。

1. calculator  —— 纯计算，错误必须是**结构化校验错误**（不能崩、不能返回 None）；
2. search_docs —— 检索类工具，**权限过滤必须在打分之前**（这是 P7 那个坑）；
3. create_ticket —— 写操作，必须有 `is_write` 标记 + 人工确认 + 幂等键。

真实项目里把这三个换成你的业务工具，**上层一行都不用改**——这就是"只改 builtin.py"的含义。
"""

from __future__ import annotations

from typing import Any

from core.errors import PERMANENT, VALIDATION
from core.types import ParamSchema, ToolContext, ToolDefinition, ToolResult, ToolSpec

# ---------------------------------------------------------------- calculator

class _Parser:
    """递归下降算术解析器：不用 eval（永远不要对模型输出用 eval）。"""

    def __init__(self, text: str):
        self.s = text.replace(" ", "")
        self.i = 0

    def parse(self) -> float:
        if not self.s:
            raise ValueError("表达式为空")
        value = self._expr()
        if self.i != len(self.s):
            raise ValueError(f"位置 {self.i} 处有多余字符 {self.s[self.i]!r}")
        return value

    def _peek(self) -> str:
        return self.s[self.i] if self.i < len(self.s) else ""

    def _expr(self) -> float:
        value = self._term()
        while self._peek() in ("+", "-"):
            op = self._peek()
            self.i += 1
            rhs = self._term()
            value = value + rhs if op == "+" else value - rhs
        return value

    def _term(self) -> float:
        value = self._factor()
        while self._peek() in ("*", "/"):
            op = self._peek()
            self.i += 1
            rhs = self._factor()
            if op == "*":
                value *= rhs
            else:
                if rhs == 0:
                    raise ValueError("除数为 0")
                value /= rhs
        return value

    def _factor(self) -> float:
        ch = self._peek()
        if ch == "(":
            self.i += 1
            value = self._expr()
            if self._peek() != ")":
                raise ValueError("括号不匹配")
            self.i += 1
            return value
        if ch in ("-", "+"):
            self.i += 1
            value = self._factor()
            return -value if ch == "-" else value
        start = self.i
        while self.i < len(self.s) and (self.s[self.i].isdigit() or self.s[self.i] == "."):
            self.i += 1
        if start == self.i:
            raise ValueError(f"位置 {self.i} 处期望数字，收到 {ch!r}")
        return float(self.s[start : self.i])


def calculator(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    expr = args.get("expression", "")
    try:
        value = _Parser(expr).parse()
    except ValueError as exc:
        # 关键：返回**可行动**的错误，模型才知道怎么改；不抛异常、不返回假结果
        return ToolResult.failure(VALIDATION, f"表达式无法解析：{exc}；请给出可计算的形式，如 `2 + 3 * 4`")
    if value == int(value):
        value = int(value)
    else:
        value = round(value, 10)
    return ToolResult.success({"expression": expr, "value": value})


# ---------------------------------------------------------------- search_docs

_DOCS: list[dict[str, Any]] = [
    {"tenant_id": "acme", "doc_id": "D-101", "title": "差旅报销标准", "text": "市内交通实报实销；高铁二等座；住宿一线城市每晚不超过 600 元。"},
    {"tenant_id": "acme", "doc_id": "D-102", "title": "采购审批流程", "text": "单笔超过 5 万元需两级审批；超过 50 万元需总经理审批。"},
    {"tenant_id": "acme", "doc_id": "D-103", "title": "年假政策", "text": "入职满一年享 5 天年假，每满一年多 1 天，上限 15 天。"},
    {"tenant_id": "globex", "doc_id": "G-201", "title": "差旅报销标准（globex）", "text": "住宿上限 800 元/晚，需提前在系统申请。"},
    {"tenant_id": "initech", "doc_id": "I-301", "title": "董事会薪酬", "text": "董事薪酬需董事会审议，机密文件，仅董事可见。"},
]


def _tokens(text: str) -> list[str]:
    return [t for t in text.replace("，", " ").replace("。", " ").split() if t]


def search_docs(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    query = args.get("query", "")
    top_k = int(args.get("top_k") or 3)

    # ① 权限过滤**在打分之前**：过滤后为空就是真的没有，不要"先取 top3 再筛"（会筛空）
    visible = [d for d in _DOCS if d["tenant_id"] == ctx.tenant_id]
    if not visible:
        return ToolResult.success({"matched": [], "note": "当前租户没有可检索的文档"})

    # ② 极简 idf 打分（真实项目换 BM25 + 向量召回 + rerank）
    q_tokens = set(_tokens(query))
    df: dict[str, int] = {}
    for d in visible:
        for t in set(_tokens(d["text"] + d["title"])):
            df[t] = df.get(t, 0) + 1

    scored = []
    for d in visible:
        body = d["text"] + d["title"]
        score = 0.0
        for t in q_tokens:
            if t in body:
                score += 1.0 + (len(visible) / (1 + df.get(t, 0)))  # 越稀缺的词权重越高
        if score > 0:
            scored.append((score, d))

    scored.sort(key=lambda x: x[0], reverse=True)
    matched = [
        {"doc_id": d["doc_id"], "title": d["title"], "score": round(s, 3), "span": d["text"]}
        for s, d in scored[:top_k]
    ]
    return ToolResult.success({"matched": matched, "count": len(matched)})


# ---------------------------------------------------------------- create_ticket

_TICKETS: dict[str, dict[str, Any]] = {}  # 幂等键 -> 已创建的工单（真实项目里是唯一索引）
_SEQ = {"n": 0}


def create_ticket(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
    title = args.get("title", "")
    body = args.get("body", "")
    confirm = bool(args.get("confirm"))

    if not confirm:
        # policy 错误：既不重试也不让模型"再猜一次"，直接要求澄清
        return ToolResult.failure(
            "policy", "创建工单是对外可见的写操作，需要用户明确确认（confirm=true）后才执行"
        )

    key = ctx.idempotency_key or ""
    if key and key in _TICKETS:
        ticket = dict(_TICKETS[key])
        ticket["idempotent_replay"] = True  # 重放：返回同一个工单，不重复创建
        return ToolResult.success(ticket)

    _SEQ["n"] += 1
    ticket = {"ticket_id": f"TICKET-{_SEQ['n']:04d}", "title": title, "body": body, "status": "open"}
    if key:
        _TICKETS[key] = dict(ticket)
    return ToolResult.success(ticket)


# ---------------------------------------------------------------- 规格登记

def build_tools() -> list[ToolDefinition]:
    return [
        ToolDefinition(
            spec=ToolSpec(
                name="calculator",
                description="计算一个算术表达式（支持 + - * / 与括号）。任何算术都必须用它，心算不可靠。",
                params={
                    "expression": ParamSchema("string", required=True, description="算术表达式，如 `2 + 3 * 4`")
                },
            ),
            handler=calculator,
        ),
        ToolDefinition(
            spec=ToolSpec(
                name="search_docs",
                description="检索当前用户有权访问的内部文档（差旅、审批、年假等制度）。",
                params={
                    "query": ParamSchema("string", required=True, description="自然语言查询"),
                    "top_k": ParamSchema("number", required=False, description="返回条数，默认 3"),
                },
            ),
            handler=search_docs,
        ),
        ToolDefinition(
            spec=ToolSpec(
                name="create_ticket",
                description="创建一个工单。**写操作**：必须先得到用户明确确认，且会带幂等键防重复创建。",
                params={
                    "title": ParamSchema("string", required=True, description="工单标题"),
                    "body": ParamSchema("string", required=True, description="工单正文"),
                    "confirm": ParamSchema("boolean", required=True, description="用户是否已明确确认"),
                },
                is_write=True,
            ),
            handler=create_ticket,
        ),
    ]
