"""参数校验：模型给的工具参数是**不可信输入**，必须按 schema 逐项校验。

为什么不用现成的 pydantic / jsonschema：
- 本骨架零第三方依赖，任何机器 `python src/main.py` 就能跑；
- 校验规则本身要能讲清（面试常问"模型给的参数你怎么防"），自己写一遍才记得住。
真实项目里换成 pydantic 完全可以，但**行为契约不变**：失败返回错误清单，不抛异常。
"""

from __future__ import annotations

from typing import Any

from .types import ParamSchema

_TYPE_CHECKS = {
    "string": lambda v: isinstance(v, str),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
}


def validate_args(params: dict[str, ParamSchema], args: dict[str, Any]) -> list[str]:
    """返回错误清单（空列表 = 通过）。错误信息要**可行动**：告诉模型该怎么改。"""
    errors: list[str] = []

    if not isinstance(args, dict):
        return [f"arguments 必须是对象，收到的是 {type(args).__name__}"]

    for name, schema in params.items():
        if name not in args or args[name] is None:
            if schema.required:
                errors.append(f"缺少必填参数 `{name}`（{schema.description or schema.type}）")
            continue

        value = args[name]
        check = _TYPE_CHECKS.get(schema.type)
        if check is None:
            errors.append(f"参数 `{name}` 声明了未知类型 `{schema.type}`")
            continue
        if not check(value):
            errors.append(
                f"参数 `{name}` 类型错误：期望 {schema.type}，收到 {type(value).__name__}"
            )
            continue
        if schema.enum is not None and value not in schema.enum:
            errors.append(f"参数 `{name}` 必须是 {schema.enum} 之一，收到 {value!r}")

    unknown = [k for k in args if k not in params]
    for key in unknown:
        errors.append(f"存在未声明的参数 `{key}`（请只用 schema 里声明的字段）")

    return errors
