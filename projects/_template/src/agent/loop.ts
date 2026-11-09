import { AppError } from "../core/errors.ts";
import type { Budget } from "../core/budget.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { ToolRegistry } from "../tools/registry.ts";
import type { Tracer } from "../obs/tracer.ts";
import type {
  LLMResponse,
  Message,
  RunResult,
  ToolCall,
  Usage,
} from "../core/types.ts";

export interface RunAgentInput {
  provider: LLMProvider;
  registry: ToolRegistry;
  messages: Message[];
  budget: Budget;
  tracer?: Tracer;
  maxToolCallsPerStep?: number;
  /**
   * 可选的运行上下文。真实项目通常从登录态读取 tenantId，
   * 从任务 ID 读取 idempotencyKey，而不是让模型自己填。
   */
  tenantId?: string;
  idempotencyKey?: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = stableValue(source[key]);
    }
    return result;
  }
  return value;
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(stableValue(value)) ?? "undefined";
  } catch {
    return String(value);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 有界 agent loop。
 *
 * 这里只负责流程，不负责工具实现、模型协议或日志落盘：
 * 预算、工具校验、错误分类都委托给各自的层。
 */
export async function runAgent(input: RunAgentInput): Promise<RunResult> {
  const conversation: Message[] = [...input.messages];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const actionCounts = new Map<string, number>();
  const tracer = input.tracer;
  const requestedLimit = input.maxToolCallsPerStep ?? 4;
  const toolLimit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.floor(requestedLimit))
    : 4;
  let steps = 0;
  let closeActiveStep: ((status: "ok" | "error", attributes?: Record<string, unknown>) => void) | undefined;

  try {
    while (true) {
      const stepSpan = tracer?.startSpan("step", `step ${steps + 1}`);
      let stepEnded = false;
      const closeStep = (status: "ok" | "error", attributes?: Record<string, unknown>): void => {
        if (stepEnded) return;
        stepEnded = true;
        if (stepSpan && tracer) {
          tracer.endSpan(stepSpan, status, { step: steps, ...attributes });
        }
      };
      closeActiveStep = closeStep;

      input.budget.step();
      input.budget.checkWallClock();
      steps += 1;

      const llmStartedAt = Date.now();
      const llmSpan = tracer?.startSpan("llm", `llm:${input.provider.name}`, stepSpan?.spanId);
      let response: LLMResponse;
      try {
        response = await input.provider.chat({
          messages: conversation,
          tools: input.registry.list(),
        });
      } catch (err) {
        if (llmSpan && tracer) {
          tracer.endSpan(llmSpan, "error", {
            step: steps,
            durationMs: Math.max(0, Date.now() - llmStartedAt),
            error: errorText(err),
          });
        }
        throw err;
      }

      if (llmSpan && tracer) {
        tracer.endSpan(llmSpan, "ok", {
          step: steps,
          finishReason: response.finishReason,
          toolCallCount: response.toolCalls.length,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd: response.usage.costUsd,
          durationMs: Math.max(0, Date.now() - llmStartedAt),
        });
      }

      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      usage.costUsd += response.usage.costUsd;
      input.budget.spend(response.usage.costUsd);

      conversation.push({ role: "assistant", content: response.content });

      if (response.finishReason === "tool_calls") {
        if (response.toolCalls.length === 0) {
          throw new AppError(
            "permanent",
            "provider returned finishReason=tool_calls without any toolCalls",
          );
        }

        for (const call of response.toolCalls) {
          const signature = `${call.name}:${stableStringify(call.args)}`;
          const count = (actionCounts.get(signature) ?? 0) + 1;
          actionCounts.set(signature, count);
          if (count >= 3) {
            closeStep("error", {
              reason: "loop_detected",
              signature,
              actionCount: count,
            });
            return {
              status: "loop_detected",
              finalContent: `loop_detected: tool "${call.name}" was called 3 times with identical arguments`,
              steps,
              usage: { ...usage },
              messages: [...conversation],
            };
          }
        }

        const executedCalls = response.toolCalls.slice(0, toolLimit);
        const skippedCalls = response.toolCalls.slice(toolLimit);

        const results = await Promise.all(
          executedCalls.map((call: ToolCall) =>
            input.registry.execute(call.name, call.args, {
              tenantId: input.tenantId ?? "default",
              traceId: tracer?.traceId ?? "no-trace",
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        );

        for (let index = 0; index < executedCalls.length; index += 1) {
          const call = executedCalls[index];
          const result = results[index];
          conversation.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: result.content,
          });
        }

        for (const call of skippedCalls) {
          conversation.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: "skipped: too many tool calls in one step",
          });
        }

        closeStep("ok", {
          finishReason: response.finishReason,
          executedToolCalls: executedCalls.length,
          skippedToolCalls: skippedCalls.length,
        });
        continue;
      }

      closeStep("ok", { finishReason: response.finishReason });
      return {
        status: "done",
        finalContent: response.content,
        steps,
        usage: { ...usage },
        messages: [...conversation],
      };
    }
  } catch (err) {
    if (closeActiveStep) {
      closeActiveStep("error", { error: errorText(err) });
      closeActiveStep = undefined;
    }
    const isBudget = err instanceof AppError && err.category === "budget";
    return {
      status: isBudget ? "budget" : "error",
      finalContent: isBudget ? errorText(err) : `error: ${errorText(err)}`,
      steps,
      usage: { ...usage },
      messages: [...conversation],
    };
  }
}
