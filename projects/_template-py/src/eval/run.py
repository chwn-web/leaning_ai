"""评测入口：python src/eval/run.py [--k 3] [--dataset data/golden.jsonl]

退出码：0 = 全部通过；1 = 有失败（可以直接挂到 CI 里当门禁）。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# 允许 `python src/eval/run.py` 直接跑：把 src/ 加进 import 路径
SRC = Path(__file__).resolve().parents[1]
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from eval.dataset import load_cases  # noqa: E402
from eval.runner import format_report, run_suite  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="运行 Agent 评测集")
    parser.add_argument("--k", type=int, default=1, help="重复次数（生产看 pass^k）")
    parser.add_argument("--dataset", default="data/golden.jsonl", help="用例文件")
    parser.add_argument("--trace-dir", default="data/traces", help="trace 落盘目录")
    parser.add_argument("--verbose", action="store_true", help="打印每条用例的答案")
    args = parser.parse_args()

    cases = load_cases(args.dataset)
    report = run_suite(cases, k=args.k, trace_dir=args.trace_dir)

    print("=" * 72)
    print(f"评测集: {args.dataset}   k={args.k}")
    print("=" * 72)
    for r in report.results:
        flag = "PASS" if r.passed else "FAIL"
        extra = "" if r.passed else f"  <- {r.fail_tag}"
        print(f"[{flag}] {r.case_id}  status={r.status} steps={r.steps}{extra}")
        if args.verbose or not r.passed:
            print(f"       answer: {r.answer}")
    print("-" * 72)
    print(format_report(report))
    return 0 if report.passed == report.total else 1


if __name__ == "__main__":
    raise SystemExit(main())
