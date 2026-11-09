import { AppError, categorize, isRetryable } from "../core/errors.ts";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  Message,
  ParamSchema,
  ToolCall,
  ToolSpec,
  Usage,
} from "../core/types.ts";

export interface LLMProvider {
  name: string;
  chat(req: LLMRequest): Promise<LLMResponse>;
}

export interface MockProviderOptions {
  script?: (req: LLMRequest) => LLMResponse;
  name?: string;
}

function tokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

/**
 * 测试和 demo 专用 provider。返回值完全由 script 决定，
 * 因此可以在零网络条件下精确构造多轮工具调用。
 */
export class MockProvider implements LLMProvider {
  name: string;
  script?: (req: LLMRequest) => LLMResponse;

  constructor(options: MockProviderOptions) {
    this.name = options.name ?? "mock";
    this.script = options.script;
  }

  async chat(req: LLMRequest): Promise<LLMResponse> {
    if (this.script) return this.script(req);

    const inputChars = req.messages.reduce((sum, message) => sum + message.content.length, 0);
    const content = `mock provider: no script configured (messages=${req.messages.length})`;
    return {
      content,
      toolCalls: [],
      usage: {
        inputTokens: tokensFromChars(inputChars),
        outputTokens: tokensFromChars(content.length),
        costUsd: 0,
      },
      finishReason: "stop",
    };
  }
}

export const PRICES_USD_PER_1K = {
  "gpt-4.1-mini": { input: 0.0004, output: 0.0016 },
  "gpt-4.1": { input: 0.002, output: 0.008 },
};

export interface OpenAICompatProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

interface OpenAIMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  name?: string;
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
  };
}

interface OpenAIRawToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: unknown;
  };
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: OpenAIRawToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function schemaToOpenAI(schema: ParamSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: schema.type,
    description: schema.description,
  };
  if (schema.enum) result.enum = schema.enum;
  if (schema.minimum !== undefined) result.minimum = schema.minimum;
  if (schema.maximum !== undefined) result.maximum = schema.maximum;
  if (schema.minLength !== undefined) result.minLength = schema.minLength;
  if (schema.maxLength !== undefined) result.maxLength = schema.maxLength;
  if (schema.pattern !== undefined) result.pattern = schema.pattern;
  if (schema.items) result.items = schemaToOpenAI(schema.items);
  return result;
}

function toOpenAITools(tools: ToolSpec[]): OpenAITool[] {
  return tools.map((tool) => {
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];
    for (const [name, schema] of Object.entries(tool.params)) {
      properties[name] = schemaToOpenAI(schema);
      if (schema.required) required.push(name);
    }
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: { type: "object", properties, required },
      },
    };
  });
}

function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((message) => {
    const mapped: OpenAIMessage = { role: message.role, content: message.content };
    if (message.toolCallId) mapped.tool_call_id = message.toolCallId;
    if (message.name) mapped.name = message.name;
    return mapped;
  });
}

function priceFor(model: string): { input: number; output: number } {
  return PRICES_USD_PER_1K[model as keyof typeof PRICES_USD_PER_1K] ?? { input: 0, output: 0 };
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceFor(model);
  return (inputTokens / 1000) * price.input + (outputTokens / 1000) * price.output;
}

/**
 * 兼容 OpenAI /chat/completions 的 provider。
 *
 * demo 不会调用它；它存在的意义是让学习者看清真实网络边界、超时、
 * usage 估算和 tool arguments 解析应该放在哪一层。
 */
export class OpenAICompatProvider implements LLMProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;

  constructor(options: OpenAICompatProviderOptions) {
    this.name = `openai-compat:${options.model}`;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async chat(req: LLMRequest): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAIMessages(req.messages),
    };
    if (req.tools.length > 0) body.tools = toOpenAITools(req.tools);
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const category = categorize(err);
      throw new AppError(category, `LLM request failed: ${err instanceof Error ? err.message : String(err)}`, err);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const category = categorize({ status: response.status });
      throw new AppError(
        category,
        `LLM HTTP ${response.status}: ${detail.slice(0, 500)}`,
        { status: response.status, body: detail },
      );
    }

    let data: OpenAIResponse;
    try {
      data = (await response.json()) as OpenAIResponse;
    } catch (err) {
      throw new AppError("permanent", "LLM response was not valid JSON", err);
    }

    const choice = data.choices?.[0];
    const rawContent = choice?.message?.content;
    const content =
      typeof rawContent === "string"
        ? rawContent
        : rawContent === undefined || rawContent === null
          ? ""
          : JSON.stringify(rawContent);

    const toolCalls: ToolCall[] = [];
    for (const [index, rawCall] of (choice?.message?.tool_calls ?? []).entries()) {
      const rawArgs = rawCall.function?.arguments;
      const rawText = typeof rawArgs === "string" ? rawArgs : "";
      let parsedArgs: unknown = {};
      if (rawText.trim().length > 0) {
        try {
          parsedArgs = JSON.parse(rawText);
        } catch (err) {
          throw new AppError(
            "validation",
            `tool call "${rawCall.function?.name ?? "unknown"}" returned invalid JSON arguments: ${rawText}`,
            rawText,
          );
        }
      }
      toolCalls.push({
        id: rawCall.id ?? `call_${index}`,
        name: rawCall.function?.name ?? "unknown",
        args: parsedArgs,
      });
    }

    const rawFinish = choice?.finish_reason;
    const finishReason: LLMResponse["finishReason"] =
      rawFinish === "tool_calls" ? "tool_calls" : rawFinish === "length" ? "length" : "stop";

    const estimatedInputChars = req.messages.reduce((sum, message) => sum + message.content.length, 0);
    const estimatedOutputChars =
      content.length + toolCalls.reduce((sum, call) => sum + JSON.stringify(call.args).length, 0);

    const inputTokens =
      typeof data.usage?.prompt_tokens === "number"
        ? data.usage.prompt_tokens
        : tokensFromChars(estimatedInputChars);
    const outputTokens =
      typeof data.usage?.completion_tokens === "number"
        ? data.usage.completion_tokens
        : tokensFromChars(estimatedOutputChars);

    const usage: Usage = {
      inputTokens,
      outputTokens,
      costUsd: calculateCost(this.model, inputTokens, outputTokens),
    };

    return { content, toolCalls, usage, finishReason };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指数退避 + 抖动，只重试 transient。重试耗尽时抛最后一次的原始错误。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries: number; baseMs: number; maxMs?: number },
): Promise<T> {
  if (!Number.isInteger(opts.maxRetries) || opts.maxRetries < 0) {
    throw new AppError("permanent", "maxRetries must be a non-negative integer");
  }
  if (opts.baseMs < 0) {
    throw new AppError("permanent", "baseMs must not be negative");
  }

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const category = categorize(err);
      if (!isRetryable(category) || attempt >= opts.maxRetries) {
        throw err;
      }
      const cap = opts.maxMs ?? 5000;
      const exponential = Math.min(cap, opts.baseMs * 2 ** attempt);
      const jittered = exponential * (0.5 + Math.random() * 0.5);
      await sleep(jittered);
      attempt += 1;
    }
  }
}
