import { fileURLToPath } from "node:url";
import { Budget } from "../core/budget.ts";
import type { GoldenCase } from "./dataset.ts";
import type { LLMRequest, LLMResponse, Message, RunResult } from "../core/types.ts";
import { MockProvider } from "../llm/provider.ts";
import { builtinTools } from "../tools/builtin.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { runAgent } from "../agent/loop.ts";
import { loadGolden } from "./dataset.ts";
import { formatReport, runEval } from "./runner.ts";

function parseK(argv: string[]): number {
  const index = argv.indexOf("--k");
  if (index < 0) return 3;
  const raw = argv[index + 1];
  if (!raw) throw new Error("--k 需要一个正整数参数");
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--k 必须是正整数，收到 ${JSON.stringify(raw)}`);
  }
  return value;
}

function mockUsage(costUsd: number): LLMResponse["usage"] {
  return { inputTokens: 120, outputTokens: 24, costUsd };
}

function extractExpression(text: string): string {
  const match = text.match(/[0-9(][0-9+\-*/().\s]*/);
  return match ? match[0].trim() : "";
}

function createEvalScript(): (req: LLMRequest) => LLMResponse {
  let callSequence = 0;

  const stop = (content: string): LLMResponse => ({
    content,
    toolCalls: [],
    usage: mockUsage(0.0002),
    finishReason: "stop",
  });

  const callTool = (name: string, args: Record<string, unknown>): LLMResponse => {
    callSequence += 1;
    return {
      content: "",
      toolCalls: [{ id: `eval-call-${callSequence}`, name, args }],
      usage: mockUsage(0.0002),
      finishReason: "tool_calls",
    };
  };

  return (req: LLMRequest): LLMResponse => {
    const last = req.messages[req.messages.length - 1];
    if (!last) return stop("没有输入，无法处理。");

    if (last.role === "tool") {
      const observation = last.content;
      if (
        observation.includes("validation_error") ||
        observation.includes("permanent_error") ||
        observation.includes("policy_error") ||
        observation.includes("transient_error") ||
        observation.includes("permission_error")
      ) {
        return stop("无法完成：工具参数校验失败，且当前 agent 无法修复。");
      }
      if (observation.startsWith("no_results:")) {
        return stop("没有找到相关信息：知识库中没有可引用的内容。");
      }
      return stop(`根据工具观察结果给出结论：${observation.slice(0, 300)}`);
    }

    if (last.role === "user") {
      const input = last.content;

      if (input.includes("不提供表达式")) {
        // 故意触发 missing required field "expression"，验证错误会回填给模型。
        return callTool("calculator", {});
      }

      if (input.includes("工单")) {
        if (/不确认|不要确认|先不要确认/.test(input)) {
          return stop("创建工单是写操作，需要你明确确认后我才能继续。");
        }
        return stop("这个 demo 不执行未提供幂等键的写操作。");
      }

      if (/帮我处理一下|不确定|随便/.test(input)) {
        return stop("请补充具体要处理的事项、对象和期望结果。");
      }

      if (/计算|算一下|算出|等于多少|[0-9)]\s*[+\-*/]\s*[0-9(]/.test(input)) {
        const expression = extractExpression(input);
        return callTool("calculator", { expression });
      }

      return callTool("search_docs", { query: input, topK: 3 });
    }

    return stop("当前输入无法继续处理。");
  };
}

function inferFailureTag(result: RunResult, goldenCase: GoldenCase): string {
  if (result.status === "budget") return "budget";
  if (result.status === "loop_detected") return "loop_detected";
  const toolMessages = result.messages.filter((message: Message) => message.role === "tool");
  if (toolMessages.some((message) => message.content.includes("validation_error"))) {
    return "tool_error";
  }
  if (toolMessages.some((message) => message.content.includes("policy_error"))) {
    return "policy";
  }
  return goldenCase.tags[0] ?? "unknown";
}

/**
 * 判定器本身也是代码，也会写错——这是评测里最容易被忽略的一环。
 *
 * 这里的分工：
 *   - 运行没正常结束（budget / loop_detected / error）→ 一定算失败；
 *   - tag 属于"本来就该拒绝"的类别（缺信息、权限、无答案、工具错）→ 应用
 *     "是否给出了可解释的拒绝"来判定，而不是要求它硬答；
 *   - 其余（happy）路径 → 只要能正常收敛且没有退化式回答就算通过。
 */
const REFUSAL_MARKERS = ["无法完成", "没有找到", "请补充", "需要你明确确认", "已阻止"];

const EXPECTED_REFUSAL_TAGS = new Set(["tool_error", "missing_info", "policy", "no_answer"]);

function judge(
  result: RunResult,
  goldenCase: GoldenCase,
): { ok: boolean; tag?: string } {
  if (result.status !== "done") {
    return { ok: false, tag: inferFailureTag(result, goldenCase) };
  }

  const answer = result.finalContent;
  const refused = REFUSAL_MARKERS.some((marker) => answer.includes(marker));
  const expectsRefusal = goldenCase.tags.some((tag) => EXPECTED_REFUSAL_TAGS.has(tag));

  if (expectsRefusal) {
    return refused ? { ok: true } : { ok: false, tag: goldenCase.tags[0] ?? "no_refusal" };
  }
  return refused ? { ok: false, tag: "over_refusal" } : { ok: true };
}

async function runOnce(goldenCase: GoldenCase): Promise<{ ok: boolean; tag?: string }> {
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);

  const provider = new MockProvider({
    name: "eval-mock",
    script: createEvalScript(),
  });
  const budget = new Budget({
    maxSteps: 5,
    maxCostUsd: 0.02,
    maxWallMs: 10000,
  });
  const messages: Message[] = [
    {
      role: "system",
      content: "你是评测用 mock agent。只能通过工具获取事实，工具报错时不要编造结果。",
    },
    { role: "user", content: goldenCase.input },
  ];

  const result = await runAgent({
    provider,
    registry,
    messages,
    budget,
    tenantId: "tenant-a",
  });

  return judge(result, goldenCase);
}

async function main(): Promise<void> {
  const k = parseK(process.argv.slice(2));
  const goldenPath = fileURLToPath(new URL("../../data/golden.jsonl", import.meta.url));
  const cases = await loadGolden(goldenPath);

  console.log(`golden: ${goldenPath}`);
  console.log(`cases: ${cases.length}, k: ${k}`);
  const startedAt = Date.now();
  const report = await runEval({ cases, runOnce, k });
  console.log("");
  console.log(formatReport(report));
  console.log("");
  console.log(`总耗时: ${Date.now() - startedAt}ms`);
}

main().catch((err: unknown) => {
  console.error(`eval 运行失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
