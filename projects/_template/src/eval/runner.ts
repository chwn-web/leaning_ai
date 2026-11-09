import { AppError } from "../core/errors.ts";
import type { GoldenCase } from "./dataset.ts";

export interface EvalReport {
  cases: number;
  k: number;
  passAtK: number;
  passHatK: number;
  failByTag: Record<string, number>;
  ci95: [number, number];
  warning?: string;
}

export interface RunCaseResult {
  ok: boolean;
  tag?: string;
}

export interface RunEvalInput {
  cases: GoldenCase[];
  runOnce: (c: GoldenCase) => Promise<RunCaseResult>;
  k: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 每个 case 独立重复 k 次。
 *
 * pass@k：k 次里至少成功一次；pass^k：k 次全部成功。
 * 两个指标不能混用，前者衡量能力上限，后者衡量稳定性。
 */
export async function runEval(input: RunEvalInput): Promise<EvalReport> {
  if (!Number.isInteger(input.k) || input.k < 1) {
    throw new AppError("validation", "k must be a positive integer");
  }

  const totalCases = input.cases.length;
  let passAtKCount = 0;
  let passHatKCount = 0;
  const failByTag: Record<string, number> = {};

  for (const goldenCase of input.cases) {
    let successRuns = 0;
    const failedTags = new Set<string>();

    for (let run = 0; run < input.k; run += 1) {
      let result: RunCaseResult;
      try {
        result = await input.runOnce(goldenCase);
      } catch {
        result = { ok: false };
      }

      if (result.ok) {
        successRuns += 1;
      } else if (result.tag && result.tag.trim().length > 0) {
        failedTags.add(result.tag.trim());
      } else {
        for (const tag of goldenCase.tags) failedTags.add(tag);
      }
    }

    if (successRuns > 0) passAtKCount += 1;
    if (successRuns === input.k) passHatKCount += 1;

    if (successRuns < input.k) {
      if (failedTags.size === 0) failedTags.add("untagged");
      for (const tag of failedTags) {
        failByTag[tag] = (failByTag[tag] ?? 0) + 1;
      }
    }
  }

  const passAtK = totalCases === 0 ? 0 : passAtKCount / totalCases;
  const passHatK = totalCases === 0 ? 0 : passHatKCount / totalCases;
  const standardError =
    totalCases === 0 ? 0 : Math.sqrt((passHatK * (1 - passHatK)) / totalCases);
  const ci95: [number, number] = [
    clamp01(passHatK - 1.96 * standardError),
    clamp01(passHatK + 1.96 * standardError),
  ];
  const warning =
    totalCases < 30 ? "样本量 <30，置信区间过宽，结论不可用于对外汇报" : undefined;

  return {
    cases: totalCases,
    k: input.k,
    passAtK,
    passHatK,
    failByTag,
    ci95,
    ...(warning ? { warning } : {}),
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function countOf(value: number, total: number): number {
  return Math.round(value * total);
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push("| 指标 | 值 |");
  lines.push("| --- | --- |");
  lines.push(`| 用例数 (n) | ${report.cases} |`);
  lines.push(`| 重复次数 (k) | ${report.k} |`);
  lines.push(
    `| pass@k (至少一次成功) | ${percent(report.passAtK)} (${countOf(report.passAtK, report.cases)}/${report.cases}) |`,
  );
  lines.push(
    `| pass^k (k 次全部成功) | ${percent(report.passHatK)} (${countOf(report.passHatK, report.cases)}/${report.cases}) |`,
  );
  lines.push(
    `| 95% CI (pass^k, 正态近似) | [${report.ci95[0].toFixed(4)}, ${report.ci95[1].toFixed(4)}] |`,
  );
  lines.push("");
  lines.push("| 失败 tag | 失败用例数 |");
  lines.push("| --- | --- |");

  const entries = Object.entries(report.failByTag).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) {
    lines.push("| (无失败) | 0 |");
  } else {
    for (const [tag, count] of entries) {
      lines.push(`| ${tag} | ${count} |`);
    }
  }

  if (report.warning) {
    lines.push("");
    lines.push(`警告: ${report.warning}`);
  }

  return lines.join("\n");
}
