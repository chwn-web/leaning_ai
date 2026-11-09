"""可观测性：把每一步落成 JSONL，出问题能**按 case 复现**，而不是靠回忆。

三个原则：
1. 结构化：一行一个 span，能被 jq / 脚本直接统计；
2. 有耗时：每个 span 记 duration_ms，性能问题才有得查；
3. 有 args：工具参数进 trace（脱敏后），否则"参数幻觉"类问题根本定位不到。
"""

from __future__ import annotations

import json
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class Tracer:
    def __init__(self, path: str | Path | None = None, *, meta: dict[str, Any] | None = None):
        trace_id = uuid.uuid4().hex[:12]
        self.path = Path(path or f"data/traces/run-{trace_id}.jsonl")
        self.trace_id = trace_id
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._spans: list[dict[str, Any]] = []
        self.path.write_text("", encoding="utf-8")
        if meta:
            self._write({"type": "meta", "trace_id": trace_id, **meta})

    def _write(self, record: dict[str, Any]) -> None:
        self._spans.append(record)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")

    @contextmanager
    def span(self, name: str, **attrs: Any) -> Iterator[dict[str, Any]]:
        """用法：with tracer.span("tool", name="calculator") as span: span["ok"] = True"""
        started = time.time()
        record: dict[str, Any] = {"type": "span", "trace_id": self.trace_id, "name": name, **attrs}
        try:
            yield record
        finally:
            record["duration_ms"] = round((time.time() - started) * 1000, 2)
            self._write(record)

    def summary(self) -> dict[str, Any]:
        spans = [s for s in self._spans if s.get("type") == "span"]
        by_name: dict[str, int] = {}
        total_ms = 0.0
        for s in spans:
            by_name[s["name"]] = by_name.get(s["name"], 0) + 1
            total_ms += float(s.get("duration_ms") or 0)
        return {
            "trace_id": self.trace_id,
            "path": str(self.path),
            "span_count": len(spans),
            "by_name": by_name,
            "total_duration_ms": round(total_ms, 2),
        }
