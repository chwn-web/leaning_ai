/**
 * 共享类型定义。
 *
 * 这个文件只放类型，不放运行时代码。所有层都依赖这里，但这里不依赖任何层，
 * 因此不会出现循环依赖。
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: "stop" | "tool_calls" | "length";
}

export interface LLMRequest {
  messages: Message[];
  tools: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * 手写的参数 schema。刻意不引入 JSON Schema 库，减少依赖和隐式行为。
 * 目前只支持标量类型；items 预留给后续扩展数组参数。
 */
export type ParamSchema = {
  type: "string" | "number" | "boolean" | "object";
  description: string;
  required?: boolean;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: ParamSchema;
};

export interface ToolSpec {
  name: string;
  description: string;
  params: Record<string, ParamSchema>;
}

export interface ToolContext {
  tenantId: string;
  traceId: string;
  idempotencyKey?: string;
}

/**
 * 错误分类统一放在 types.ts，errors.ts 复用并转导出，避免 types/errors 循环依赖。
 */
export type ErrorCategory =
  | "transient"
  | "permanent"
  | "policy"
  | "permission"
  | "validation"
  | "budget";

export interface ToolResult {
  ok: boolean;
  content: string;
  errorKind?: ErrorCategory;
  durationMs: number;
}

export interface ToolDefinition {
  spec: ToolSpec;
  timeoutMs?: number;
  isWrite?: boolean;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export interface RunResult {
  status: "done" | "budget" | "loop_detected" | "error";
  finalContent: string;
  steps: number;
  usage: Usage;
  messages: Message[];
}

export type SpanKind = "llm" | "tool" | "step";

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  kind: SpanKind;
  name: string;
  startMs: number;
  endMs?: number;
  attributes: Record<string, unknown>;
  status: "ok" | "error";
}
