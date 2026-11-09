import { AppError, categorize } from "../core/errors.ts";
import type {
  ErrorCategory,
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolSpec,
} from "../core/types.ts";
import { validateArgs } from "../core/validate.ts";
import { withRetry } from "../llm/provider.ts";
import type { Tracer } from "../obs/tracer.ts";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 工具注册表是模型与真实副作用之间唯一的门。
 *
 * 所有校验、超时、重试、幂等策略、错误分类和耗时统计都在这里完成，
 * 避免每个 handler 各自实现一套。
 */
export class ToolRegistry {
  definitions: Map<string, ToolDefinition>;
  tracer?: Tracer;

  constructor(tracer?: Tracer) {
    this.definitions = new Map<string, ToolDefinition>();
    this.tracer = tracer;
  }

  register(definition: ToolDefinition): void {
    if (this.definitions.has(definition.spec.name)) {
      throw new AppError("permanent", `tool "${definition.spec.name}" is already registered`);
    }
    this.definitions.set(definition.spec.name, definition);
  }

  list(): ToolSpec[] {
    return [...this.definitions.values()].map((definition) => definition.spec);
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  async execute(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now();
    const span = this.tracer?.startSpan("tool", `tool:${name}`);

    const finish = (
      ok: boolean,
      content: string,
      errorKind?: ErrorCategory,
    ): ToolResult => {
      const durationMs = Math.max(0, Date.now() - startedAt);
      if (span && this.tracer) {
        this.tracer.endSpan(span, ok ? "ok" : "error", {
          tool: name,
          ok,
          durationMs,
          ...(errorKind ? { errorKind } : {}),
        });
      }
      return {
        ok,
        content,
        ...(errorKind ? { errorKind } : {}),
        durationMs,
      };
    };

    const definition = this.definitions.get(name);
    if (!definition) {
      return finish(false, `unknown tool "${name}". Available tools: ${this.list().map((t) => t.name).join(", ")}`, "permanent");
    }

    if (definition.isWrite && !ctx.idempotencyKey) {
      return finish(
        false,
        `write operation "${name}" requires ctx.idempotencyKey; refusing to execute to avoid duplicate side effects`,
        "policy",
      );
    }

    const validation = validateArgs(definition.spec, args);
    if (!validation.ok) {
      return finish(
        false,
        `validation_error: ${validation.errors.join("; ")}`,
        "validation",
      );
    }

    const timeoutMs = definition.timeoutMs ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return finish(false, `tool "${name}" has an invalid timeoutMs`, "permanent");
    }

    const invokeOnce = async (): Promise<string> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AppError("transient", `tool "${name}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      try {
        return await Promise.race([
          Promise.resolve().then(() => definition.handler(validation.value, ctx)),
          timeout,
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    try {
      const content = await invokeOnce();
      return finish(true, content);
    } catch (err) {
      const firstCategory = categorize(err);
      if (firstCategory !== "transient") {
        return finish(false, `${firstCategory}_error: ${errorMessage(err)}`, firstCategory);
      }

      try {
        const content = await withRetry(invokeOnce, {
          maxRetries: 2,
          baseMs: 50,
          maxMs: 500,
        });
        return finish(true, content);
      } catch (retryErr) {
        const finalCategory = categorize(retryErr);
        return finish(
          false,
          `${finalCategory}_error after retry: ${errorMessage(retryErr)}`,
          finalCategory,
        );
      }
    }
  }
}
