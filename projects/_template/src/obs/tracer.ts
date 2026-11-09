import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Span, SpanKind } from "../core/types.ts";

export interface TracerOptions {
  traceId: string;
  dir: string;
  now?: () => number;
}

export interface TraceSummary {
  spans: number;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  wallMs: number;
}

/**
 * 极简内存 tracer：span 先收集在内存，运行结束后一次性落盘。
 * 选择 JSONL 是为了不引入数据库，也方便用 node -e 逐行校验。
 */
export class Tracer {
  traceId: string;
  dir: string;
  now: () => number;
  startedAt: number;
  spans: Span[];

  constructor(options: TracerOptions) {
    this.traceId = options.traceId;
    this.dir = options.dir;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.spans = [];
  }

  startSpan(kind: SpanKind, name: string, parentSpanId?: string): Span {
    const span: Span = {
      traceId: this.traceId,
      spanId: randomUUID(),
      kind,
      name,
      startMs: this.now(),
      attributes: {},
      status: "ok",
    };
    if (parentSpanId !== undefined) span.parentSpanId = parentSpanId;
    this.spans.push(span);
    return span;
  }

  endSpan(span: Span, status: "ok" | "error", attributes?: Record<string, unknown>): void {
    span.endMs = this.now();
    span.status = status;
    if (attributes) {
      Object.assign(span.attributes, attributes);
    }
  }

  getSpans(): Span[] {
    return [...this.spans];
  }

  async flush(): Promise<string> {
    fs.mkdirSync(this.dir, { recursive: true });
    const filePath = path.join(this.dir, `${this.traceId}.jsonl`);
    const payload = this.spans.map((span) => JSON.stringify(span)).join("\n");
    await fs.promises.appendFile(filePath, payload.length > 0 ? `${payload}\n` : "", "utf8");
    return filePath;
  }

  summary(): TraceSummary {
    let llmCalls = 0;
    let toolCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;

    for (const span of this.spans) {
      if (span.kind === "llm") {
        llmCalls += 1;
        const input = span.attributes.inputTokens;
        const output = span.attributes.outputTokens;
        const cost = span.attributes.costUsd;
        if (typeof input === "number" && Number.isFinite(input)) inputTokens += input;
        if (typeof output === "number" && Number.isFinite(output)) outputTokens += output;
        if (typeof cost === "number" && Number.isFinite(cost)) costUsd += cost;
      } else if (span.kind === "tool") {
        toolCalls += 1;
      }
    }

    return {
      spans: this.spans.length,
      llmCalls,
      toolCalls,
      inputTokens,
      outputTokens,
      costUsd,
      wallMs: Math.max(0, this.now() - this.startedAt),
    };
  }
}
