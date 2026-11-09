/**
 * 骨架 demo 的入口。
 *
 * 运行：node src/main.ts
 *
 * 这个文件只做一件事：用 MockProvider 把"真实 agent 会遇到的 5 种情况"
 * 各跑一遍，让你看到每一层的输出长什么样。
 *
 * 它刻意不联网、不读真实模型——因为骨架的价值是"任意时刻都能重放"。
 * 真实 provider（OpenAICompatProvider）的实现已经写在 llm/provider.ts 里，
 * 换成它只需要改一行构造。
 *
 * 五个场景对应后面项目的第一课：
 *   1 正常链路      → 工具调用 + 观察回填 + 收敛
 *   2 参数校验失败  → 错误信息回填给模型，模型自己修
 *   3 死循环        → 用动作签名检测，不是靠步数硬砍
 *   4 写操作        → 幂等键 + 人工确认 + 重放不重复建单
 *   5 预算耗尽      → 花完钱之前先停，而不是崩
 */

import { fileURLToPath } from "node:url";
import { Budget } from "./core/budget.ts";
import type { LLMRequest, LLMResponse, Message, RunResult, ToolCall } from "./core/types.ts";
import { MockProvider } from "./llm/provider.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { builtinTools } from "./tools/builtin.ts";
import { Tracer } from "./obs/tracer.ts";
import { runAgent } from "./agent/loop.ts";

const TRACE_DIR = fileURLToPath(new URL("../data/traces", import.meta.url));
const SYSTEM_PROMPT =
  "你是内部支持助手。先判断能否用工具拿到事实；工具报错时不要编造，按错误提示修正或直接说明无法完成。";

/** 每次 mock 调用的固定开销，方便观察 cost 累加 */
const MOCK_USAGE = { inputTokens: 160, outputTokens: 32, costUsd: 0.0004 };

function stop(content: string): LLMResponse {
  return { content, toolCalls: [], usage: { ...MOCK_USAGE }, finishReason: "stop" };
}

function callTools(calls: ToolCall[]): LLMResponse {
  return { content: "", toolCalls: calls, usage: { ...MOCK_USAGE }, finishReason: "tool_calls" };
}

function lastMessage(req: LLMRequest): Message | undefined {
  return req.messages.length > 0 ? req.messages[req.messages.length - 1] : undefined;
}

interface Scenario {
  id: string;
  title: string;
  question: string;
  /** 你期望看到的现象，打印在结果行里，逼你"先预测再运行" */
  expect: string;
  /** 这个场景证明了哪一层在起作用 */
  lesson: string;
  script: (req: LLMRequest) => LLMResponse;
  budget?: { maxSteps: number; maxCostUsd: number; maxWallMs: number };
  tenantId?: string;
  idempotencyKey?: string;
}

interface ScenarioOutcome {
  id: string;
  title: string;
  result: RunResult;
  tracePath?: string;
  expect: string;
  lesson: string;
}

async function runScenario(scenario: Scenario): Promise<ScenarioOutcome> {
  const tracer = new Tracer({
    traceId: `${scenario.id}-${Date.now().toString(36)}`,
    dir: TRACE_DIR,
  });

  const registry = new ToolRegistry(tracer);
  for (const tool of builtinTools) registry.register(tool);

  const provider = new MockProvider({ name: `mock-${scenario.id}`, script: scenario.script });
  const budget = new Budget(
    scenario.budget ?? { maxSteps: 6, maxCostUsd: 0.05, maxWallMs: 10_000 },
  );

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: scenario.question },
  ];

  const result = await runAgent({
    provider,
    registry,
    messages,
    budget,
    tracer,
    tenantId: scenario.tenantId ?? "tenant-a",
    ...(scenario.idempotencyKey ? { idempotencyKey: scenario.idempotencyKey } : {}),
  });

  const tracePath = await tracer.flush();
  return {
    id: scenario.id,
    title: scenario.title,
    result,
    tracePath,
    expect: scenario.expect,
    lesson: scenario.lesson,
  };
}

/** 从工具观察结果里取出内容，模拟模型"读懂了 observation" */
function observationSummary(result: RunResult): string {
  const toolMessages = result.messages.filter((message) => message.role === "tool");
  return toolMessages.map((message) => message.content).join(" | ");
}

function buildScenarios(): Scenario[] {
  return [
    // ── 1. 正常链路 ────────────────────────────────────────────────
    {
      id: "S1",
      title: "正常链路：一次工具调用后收敛",
      question: "请计算 2 + 3 * 4",
      expect: "1 次工具调用、2 步、status=done",
      lesson: "L5 编排 + L2 工具：模型只负责决定调用，执行和校验在 registry",
      script: (req) => {
        const last = lastMessage(req);
        if (last?.role === "tool") {
          return stop(`计算器结果是 ${last.content}，所以答案是 14。`);
        }
        return callTools([{ id: "call-calc", name: "calculator", args: { expression: "2 + 3 * 4" } }]);
      },
    },

    // ── 2. 参数校验失败后自我修复 ──────────────────────────────────
    {
      id: "S2",
      title: "参数非法：错误回填后模型自己修好",
      question: "帮我算一下 12 * (3 + 1)",
      expect: "第 1 次调用缺 expression 被拒，第 2 次带正确参数成功",
      lesson: "L2 工具：校验失败返回 ok:false + validation_error，而不是抛异常打断整个 run",
      script: (() => {
        let attempts = 0;
        return (req: LLMRequest) => {
          const last = lastMessage(req);
          if (last?.role === "tool" && last.content.includes("validation_error")) {
            // 模型看到了具体错误，于是补上字段
            return callTools([
              { id: "call-fix", name: "calculator", args: { expression: "12 * (3 + 1)" } },
            ]);
          }
          if (last?.role === "tool") {
            return stop(`补上参数后成功：${last.content}`);
          }
          attempts += 1;
          if (attempts === 1) {
            return callTools([{ id: "call-bad", name: "calculator", args: {} }]);
          }
          return stop("不应该走到这里");
        };
      })(),
    },

    // ── 3. 死循环检测 ─────────────────────────────────────────────
    {
      id: "S3",
      title: "死循环：同参数重复 3 次被拦截",
      question: "帮我查一下退款政策",
      expect: "status=loop_detected，在第 3 步停下",
      lesson: "L5 编排：用动作签名（name + 稳定序列化的 args）判重，比 maxSteps 更早止损",
      script: () =>
        callTools([{ id: "call-loop", name: "search_docs", args: { query: "退款政策" } }]),
    },

    // ── 4a. 写操作缺少幂等键 ──────────────────────────────────────
    {
      id: "S4a",
      title: "写操作缺少幂等键：直接拒绝执行",
      question: "帮我建一个工单",
      expect: "policy_error：requires ctx.idempotencyKey",
      lesson: "L2 工具：isWrite 的工具在 registry 层就要求幂等键，handler 永远不会被调用",
      script: (req) => {
        const last = lastMessage(req);
        if (last?.role === "tool") {
          // 模型看到"缺少幂等键"，正确做法是停下来说明原因，而不是原样重试
          return stop(`无法创建工单：调用方没有提供幂等键（${last.content.slice(0, 80)}），已阻止潜在的重复建单。`);
        }
        return callTools([
          { id: "call-ticket-1", name: "create_ticket", args: { title: "登录页 500", priority: "high", confirm: true } },
        ]);
      },
    },

    // ── 4b. 幂等键 + 确认 → 建单成功 ─────────────────────────────
    {
      id: "S4b",
      title: "写操作：幂等键 + confirm=true 才落库",
      question: "帮我建一个工单",
      expect: "TICKET-0001，idempotentReplay=false",
      lesson: "L2 工具：confirm 由用户意图决定、幂等键由调用方决定，都不许模型自己编",
      script: (req) => {
        const last = lastMessage(req);
        if (last?.role === "tool") return stop(`建单结果：${last.content}`);
        return callTools([
          { id: "call-ticket-2", name: "create_ticket", args: { title: "登录页 500", priority: "high", confirm: true } },
        ]);
      },
      idempotencyKey: "ticket-req-001",
    },

    // ── 4c. 同一个幂等键重放 ─────────────────────────────────────
    {
      id: "S4c",
      title: "同一个幂等键重放：返回同一张单",
      question: "重新帮我建一个工单",
      expect: "同一个 ticketId，idempotentReplay=true",
      lesson: "L2 工具：超时重试/用户重复点击都不会产生第二张工单",
      script: (req) => {
        const last = lastMessage(req);
        if (last?.role === "tool") return stop(`重放结果：${last.content}`);
        return callTools([
          { id: "call-ticket-3", name: "create_ticket", args: { title: "登录页 500", priority: "high", confirm: true } },
        ]);
      },
      idempotencyKey: "ticket-req-001",
    },

    // ── 5. 预算耗尽 ───────────────────────────────────────────────
    {
      id: "S5",
      title: "预算耗尽：花超之前停下，返回可解释状态",
      question: "把这件事一直做下去",
      expect: "status=budget，步数停在预算边界",
      lesson: "L0 横切：预算不是 try/catch，是每一步开始前的准入检查",
      budget: { maxSteps: 2, maxCostUsd: 1, maxWallMs: 10_000 },
      script: (() => {
        let n = 0;
        return () => {
          n += 1;
          // 每次参数不同，避开死循环检测，专门验证步数预算
          return callTools([
            { id: `call-budget-${n}`, name: "calculator", args: { expression: `1 + ${n}` } },
          ]);
        };
      })(),
    },
  ];
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function money(usd: number): string {
  return `$${usd.toFixed(6)}`;
}

async function main(): Promise<void> {
  const scenarios = buildScenarios();
  const outcomes: ScenarioOutcome[] = [];

  for (const scenario of scenarios) {
    const outcome = await runScenario(scenario);
    outcomes.push(outcome);

    const { result } = outcome;
    console.log("");
    console.log(`── ${scenario.id} ${scenario.title}`);
    console.log(`   问题   : ${scenario.question}`);
    console.log(`   预期   : ${scenario.expect}`);
    console.log(`   状态   : ${result.status}（步数 ${result.steps}，成本 ${money(result.usage.costUsd)}）`);
    console.log(`   最终   : ${result.finalContent.slice(0, 200)}`);
    const observation = observationSummary(result);
    if (observation.length > 0) {
      console.log(`   观察   : ${observation.slice(0, 300)}`);
    }
    console.log(`   机制   : ${scenario.lesson}`);
    console.log(`   trace  : ${outcome.tracePath}`);
  }

  console.log("");
  console.log("── 汇总");
  console.log(`${pad("场景", 6)}${pad("状态", 16)}${pad("步数", 6)}${pad("成本", 14)}预期`);
  for (const outcome of outcomes) {
    const { result } = outcome;
    console.log(
      `${pad(outcome.id, 6)}${pad(result.status, 16)}${pad(String(result.steps), 6)}${pad(money(result.usage.costUsd), 14)}${outcome.expect}`,
    );
  }

  const totalCost = outcomes.reduce((sum, outcome) => sum + outcome.result.usage.costUsd, 0);
  const failed = outcomes.filter((outcome) => outcome.result.status === "error");
  console.log("");
  console.log(`总成本 ${money(totalCost)}，trace 目录 ${TRACE_DIR}`);
  if (failed.length > 0) {
    console.log(`有 ${failed.length} 个场景以 error 结束，请检查上面的输出。`);
    process.exitCode = 1;
  } else {
    console.log("全部场景按预期结束（done / loop_detected / policy 拒绝 / budget 都是预期状态）。");
  }
}

main().catch((err: unknown) => {
  console.error(`demo 运行失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
