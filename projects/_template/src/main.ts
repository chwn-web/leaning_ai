/**
 * 骨架 demo 入口。
 *
 * 运行：node src/main.ts
 *
 * 这个文件是组合根：只负责把 provider、工具、预算、tracer 组装起来，
 * 然后把一次完整 agent 运行拆成可观察的五段输出：
 *   1. 每一步做了什么、耗时多少
 *   2. 最终答案
 *   3. 预算快照
 *   4. tracer 汇总
 *   5. trace 文件路径
 *
 * 最后再演示一次失败路径：模型漏传 required 字段时，registry 返回
 * validation 错误，并由 agent 作为 tool observation 回填给模型。
 * 全程使用 MockProvider，不发起真实网络请求。
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Budget } from "./core/budget.ts";
import type {
  LLMRequest,
  LLMResponse,
  Message,
  RunResult,
  Span,
} from "./core/types.ts";
import { MockProvider } from "./llm/provider.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { builtinTools } from "./tools/builtin.ts";
import { Tracer } from "./obs/tracer.ts";
import { runAgent } from "./agent/loop.ts";

const TRACE_DIR = fileURLToPath(new URL("../data/traces", import.meta.url));
const TENANT_ID = "tenant-a";
const SYSTEM_PROMPT =
  "你是内部支持助手。先用工具拿事实，再回答；工具报错时不要编造，要按错误提示修正或明确说明无法完成。";

const MOCK_USAGE = {
  inputTokens: 120,
  outputTokens: 30,
  costUsd: 0.0004,
};

function stop(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    usage: { ...MOCK_USAGE },
    finishReason: "stop",
  };
}

function callTool(toolName: string, args: Record<string, unknown>): LLMResponse {
  return {
    content: "",
    toolCalls: [{ id: `demo-${randomUUID()}`, name: toolName, args }],
    usage: { ...MOCK_USAGE },
    finishReason: "tool_calls",
  };
}

interface CalcObservation {
  expression: string;
  result: number;
}

interface DocHit {
  title: string;
  span: { quote: string };
}

interface SearchObservation {
  results: DocHit[];
}

function parseToolJson<T>(content: string): T | undefined {
  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

function lastMessage(req: LLMRequest): Message | undefined {
  return req.messages.length > 0 ? req.messages[req.messages.length - 1] : undefined;
}

/**
 * 三轮 mock 脚本：
 *   第 1 轮：调用 calculator 计算 2 + 3 * 4
 *   第 2 轮：拿到结果后调用 search_docs 查询退款政策
 *   第 3 轮：读取两份 observation，返回最终答案
 *
 * 脚本读取的是完整的 request.messages，所以它能看到上一轮 tool 消息，
 * 这就是 MockProvider 支持多轮决策的方式。
 */
function demoScript(req: LLMRequest): LLMResponse {
  const toolMessages = req.messages.filter((message) => message.role === "tool");

  if (toolMessages.length === 0) {
    return callTool("calculator", { expression: "2 + 3 * 4" });
  }

  if (toolMessages.length === 1) {
    return callTool("search_docs", { query: "退款政策", topK: 3 });
  }

  const calc = parseToolJson<CalcObservation>(toolMessages[0].content);
  const search = parseToolJson<SearchObservation>(toolMessages[1].content);
  const quote = search?.results[0]?.span.quote ?? "知识库未返回可引用的退款条款";
  const result = calc?.result ?? "未知";

  return stop(`2 + 3 * 4 = ${result}。根据知识库：${quote}`);
}

function groupSteps(result: RunResult, tracer: Tracer): string[] {
  const steps: Array<{ tools: string[]; durationMs: number }> = [];

  for (const message of result.messages) {
    if (message.role === "assistant") {
      steps.push({ tools: [], durationMs: 0 });
    } else if (message.role === "tool" && steps.length > 0) {
      steps[steps.length - 1].tools.push(message.name ?? "tool");
    }
  }

  const stepSpans = tracer
    .getSpans()
    .filter((span: Span) => span.kind === "step")
    .sort((left: Span, right: Span) => left.startMs - right.startMs);
  const toolSpans = tracer
    .getSpans()
    .filter((span: Span) => span.kind === "tool")
    .sort((left: Span, right: Span) => left.startMs - right.startMs);

  let toolIndex = 0;
  return steps.map((step, index) => {
    const span = stepSpans[index];
    if (span?.endMs !== undefined) {
      step.durationMs = Math.max(0, span.endMs - span.startMs);
    }

    const actions = ["llm"];
    for (const toolName of step.tools) {
      const toolSpan = toolSpans[toolIndex];
      toolIndex += 1;
      const toolMs =
        toolSpan?.endMs !== undefined ? Math.max(0, toolSpan.endMs - toolSpan.startMs) : 0;
      actions.push(`${toolName}(${toolMs}ms)`);
    }

    return `step ${index + 1}: ${actions.join(" -> ")} | ${step.durationMs}ms`;
  });
}

function findObservation(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "tool") return messages[index].content;
  }
  return "(没有 tool observation)";
}

/**
 * 失败路径演示：故意漏掉 calculator 的 required 参数 expression。
 *
 * 关键不是"报错"，而是错误要可读、可回填：
 *   validation_error: missing required field "expression" (string): ...
 * 模型下一次调用会看到这句话，因此有机会自己修正；这里演示它仍然
 * 无法完成时，agent 应该停下来，而不是编造一个计算结果。
 */
async function runFailurePath(): Promise<void> {
  console.log("");
  console.log("=== 失败路径演示：缺 required 参数被回填给模型 ===");

  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);

  const direct = await registry.execute("calculator", {}, {
    tenantId: TENANT_ID,
    traceId: "failure-demo",
  });
  console.log("registry.execute(calculator, {})");
  console.log(`  ok=${direct.ok}, errorKind=${direct.errorKind ?? "none"}, durationMs=${direct.durationMs}`);
  console.log(`  observation: ${direct.content}`);

  const provider = new MockProvider({
    name: "mock-failure",
    script: (req: LLMRequest): LLMResponse => {
      const message = lastMessage(req);
      if (message?.role === "tool") {
        return stop(`模型看到 observation 后停止，不会假装计算成功：${message.content}`);
      }
      return callTool("calculator", {});
    },
  });

  const budget = new Budget({
    maxSteps: 3,
    maxCostUsd: 0.01,
    maxWallMs: 5_000,
  });
  const result = await runAgent({
    provider,
    registry,
    budget,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "计算一个表达式，但我不提供表达式。" },
    ],
    tenantId: TENANT_ID,
  });

  console.log(`agent 结束状态: ${result.status}，步数: ${result.steps}`);
  console.log(`回填给模型的 observation: ${findObservation(result.messages)}`);
}

async function main(): Promise<void> {
  const traceId = randomUUID();
  const tracer = new Tracer({ traceId, dir: TRACE_DIR });
  const registry = new ToolRegistry(tracer);
  for (const tool of builtinTools) registry.register(tool);

  const provider = new MockProvider({ name: "demo-mock", script: demoScript });
  const budget = new Budget({
    maxSteps: 8,
    maxCostUsd: 0.05,
    maxWallMs: 30_000,
  });

  const result = await runAgent({
    provider,
    registry,
    budget,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "请算一下 2 + 3 * 4，并告诉我退款政策。" },
    ],
    tracer,
    tenantId: TENANT_ID,
  });

  const tracePath = await tracer.flush();

  console.log("=== 1) 每步动作与耗时 ===");
  for (const line of groupSteps(result, tracer)) console.log(line);

  console.log("");
  console.log("=== 2) 最终答案 ===");
  console.log(result.finalContent);

  console.log("");
  console.log("=== 3) budget 快照 ===");
  console.log(JSON.stringify(budget.snapshot(), null, 2));

  console.log("");
  console.log("=== 4) tracer.summary() ===");
  console.log(JSON.stringify(tracer.summary(), null, 2));

  console.log("");
  console.log("=== 5) trace 文件 ===");
  console.log(tracePath);

  if (result.status !== "done") {
    console.log(`\n主流程没有正常结束: ${result.status}`);
    process.exitCode = 1;
  }

  await runFailurePath();
}

main().catch((error: unknown) => {
  console.error(`demo 运行失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
