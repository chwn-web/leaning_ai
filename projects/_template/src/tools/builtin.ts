import { AppError } from "../core/errors.ts";
import type { ToolDefinition } from "../core/types.ts";

/**
 * calculator 的参数只允许这些字符，先由 registry 的 pattern 校验挡住明显非法的输入，
 * 再由解析器负责语法和除零检查。
 */
export const calculatorTool: ToolDefinition = {
  spec: {
    name: "calculator",
    description:
      "计算一个四则运算表达式。支持加 (+)、减 (-)、乘 (*)、除 (/)、括号和小数。调用时必须提供 expression，例如 \"(12.5 + 3) * 2\"。不要用它做单位换算或符号运算。除零会返回 permanent 错误。",
    params: {
      expression: {
        type: "string",
        description: "要计算的表达式，只允许数字、空格、括号和 + - * / 四个运算符。",
        required: true,
        minLength: 1,
        maxLength: 500,
        pattern: "^[0-9+\\-*/().\\s]+$",
      },
    },
  },
  timeoutMs: 1000,
  handler: async (args) => {
    const expression = String(args.expression ?? "");
    const value = evaluateExpression(expression);
    return JSON.stringify({ expression, result: value });
  },
};

/**
 * 手写递归下降解析器，避免 eval/new Function 带来的注入风险。
 *
 * expression := term (("+" | "-") term)*
 * term       := factor (("*" | "/") factor)*
 * factor     := ("+" | "-") factor | "(" expression ")" | number
 */
export function evaluateExpression(expression: string): number {
  let position = 0;

  function skipWhitespace(): void {
    while (position < expression.length && /\s/.test(expression[position])) position += 1;
  }

  function peek(): string | undefined {
    return expression[position];
  }

  function parseExpression(): number {
    let value = parseTerm();
    while (true) {
      skipWhitespace();
      const token = peek();
      if (token === "+") {
        position += 1;
        value += parseTerm();
      } else if (token === "-") {
        position += 1;
        value -= parseTerm();
      } else {
        return value;
      }
    }
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (true) {
      skipWhitespace();
      const token = peek();
      if (token === "*") {
        position += 1;
        value *= parseFactor();
      } else if (token === "/") {
        position += 1;
        const divisor = parseFactor();
        if (divisor === 0) {
          throw new AppError("permanent", "division by zero is not allowed");
        }
        value /= divisor;
      } else {
        return value;
      }
      if (!Number.isFinite(value)) {
        throw new AppError("permanent", "calculation overflowed to a non-finite number");
      }
    }
  }

  function parseFactor(): number {
    skipWhitespace();
    const token = peek();
    if (token === undefined) {
      throw new AppError("permanent", `unexpected end of expression at position ${position}`);
    }
    if (token === "+") {
      position += 1;
      return parseFactor();
    }
    if (token === "-") {
      position += 1;
      return -parseFactor();
    }
    if (token === "(") {
      position += 1;
      const value = parseExpression();
      skipWhitespace();
      if (peek() !== ")") {
        throw new AppError("permanent", `missing ")" at position ${position}`);
      }
      position += 1;
      return value;
    }

    const match = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(expression.slice(position));
    if (!match) {
      throw new AppError(
        "permanent",
        `unexpected character "${token}" at position ${position}; expected a number or "("`,
      );
    }
    position += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw new AppError("permanent", `invalid number "${match[0]}"`);
    }
    return value;
  }

  if (expression.trim().length === 0) {
    throw new AppError("permanent", "expression is empty");
  }

  const result = parseExpression();
  skipWhitespace();
  if (position < expression.length) {
    throw new AppError(
      "permanent",
      `unexpected token "${expression[position]}" at position ${position}`,
    );
  }
  if (!Number.isFinite(result)) {
    throw new AppError("permanent", "calculation result is not finite");
  }
  return result;
}

interface DocEntry {
  docId: string;
  title: string;
  text: string;
  acl: string[];
}

const DOC_CORPUS: DocEntry[] = [
  {
    docId: "doc-101",
    title: "退款政策说明",
    text: "标准版用户可在付款后 7 天内申请退款，超过 7 天需要联系人工客服处理。已使用的服务额度不支持退款。",
    acl: ["public"],
  },
  {
    docId: "doc-102",
    title: "企业版 SLA 与赔偿",
    text: "企业版提供 99.95% 的月度可用性承诺。未达到 SLA 时，tenant-a 客户可按合同申请服务抵扣。",
    acl: ["public", "tenant-a"],
  },
  {
    docId: "doc-103",
    title: "发票开具流程",
    text: "在控制台的费用中心申请增值税普通发票或专用发票。电子发票通常在 3 个工作日内发送到财务邮箱。",
    acl: ["public"],
  },
  {
    docId: "doc-104",
    title: "账号安全与登录保护",
    text: "建议开启双因素认证，并定期轮换密码。发现异常登录时立即冻结会话并联系安全团队。",
    acl: ["public"],
  },
  {
    docId: "doc-105",
    title: "tenant-a 专属配额",
    text: "tenant-a 的专属配额为每月 200 万次调用。配额用尽后需要提交扩容审批，审批通过后次日生效。",
    acl: ["tenant-a"],
  },
  {
    docId: "doc-106",
    title: "API 限流规则",
    text: "默认每个 API Key 每分钟 600 次请求。触发限流会返回 HTTP 429，客户端应使用指数退避重试。",
    acl: ["public"],
  },
  {
    docId: "doc-107",
    title: "数据导出与保留",
    text: "管理员可以在设置中导出近 90 天的数据。导出文件保留 7 天，过期后自动删除。",
    acl: ["public", "tenant-a"],
  },
];

function tokenize(text: string): string[] {
  const runs = text.toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]+/g) ?? [];
  const tokens: string[] = [];
  for (const run of runs) {
    if (/^[a-z0-9_]+$/.test(run)) {
      tokens.push(run);
    } else if (run.length === 1) {
      tokens.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i += 1) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

function countHits(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found < 0) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

function pickSpan(text: string, tokens: string[]): { start: number; end: number; quote: string } {
  const lower = text.toLowerCase();
  let hitIndex = -1;
  let hitToken = "";
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0 && (hitIndex < 0 || index < hitIndex)) {
      hitIndex = index;
      hitToken = token;
    }
  }
  if (hitIndex < 0) {
    return { start: 0, end: Math.min(text.length, 60), quote: text.slice(0, 60) };
  }
  const start = Math.max(0, hitIndex - 18);
  const end = Math.min(text.length, hitIndex + hitToken.length + 42);
  return { start, end, quote: text.slice(start, end) };
}

/**
 * 一个刻意很小的文档检索 demo。
 *
 * 注意：ACL 过滤发生在打分之前，而不是先检索再隐藏结果。
 * 这样即使评分逻辑有 bug，也不会把其他租户的文档排进结果集。
 */
export const searchDocsTool: ToolDefinition = {
  spec: {
    name: "search_docs",
    description:
      "在内部帮助文档中做关键词检索。返回按相关度排序的引用列表，每项包含 docId、title、score 和原文 span。query 至少 2 个字符；topK 可选，默认 3，范围 1 到 10。没有命中时返回以 no_results: 开头的说明。",
    params: {
      query: {
        type: "string",
        description: "检索关键词或自然语言问题，最少 2 个字符。",
        required: true,
        minLength: 2,
        maxLength: 200,
      },
      topK: {
        type: "number",
        description: "返回的文档数量，默认 3，最小 1，最大 10。",
        minimum: 1,
        maximum: 10,
      },
    },
  },
  timeoutMs: 1000,
  handler: async (args, ctx) => {
    const query = String(args.query ?? "");
    const topK = typeof args.topK === "number" ? args.topK : 3;

    const accessible = DOC_CORPUS.filter(
      (doc) => doc.acl.includes("public") || doc.acl.includes(ctx.tenantId),
    );

    const queryTokens = [...new Set(tokenize(query))];
    if (queryTokens.length === 0) {
      return `no_results: 没有可用于检索的关键词（query=${JSON.stringify(query)}, tenantId=${ctx.tenantId}）`;
    }

    const documentFrequency = new Map<string, number>();
    for (const token of queryTokens) {
      let count = 0;
      for (const doc of accessible) {
        if (
          countHits(doc.title.toLowerCase(), token) > 0 ||
          countHits(doc.text.toLowerCase(), token) > 0
        ) {
          count += 1;
        }
      }
      documentFrequency.set(token, count);
    }

    const scored = accessible.map((doc) => {
      const title = doc.title.toLowerCase();
      const text = doc.text.toLowerCase();
      let score = 0;
      for (const token of queryTokens) {
        const df = documentFrequency.get(token) ?? 0;
        const idf = Math.log((accessible.length + 1) / (df + 1)) + 1;
        const hits = countHits(title, token) * 2 + countHits(text, token);
        score += hits * idf;
      }
      return { doc, score };
    });

    const results = scored
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.doc.docId.localeCompare(right.doc.docId))
      .slice(0, topK)
      .map((item) => ({
        docId: item.doc.docId,
        title: item.doc.title,
        score: Number(item.score.toFixed(4)),
        span: pickSpan(item.doc.text, queryTokens),
      }));

    if (results.length === 0) {
      return `no_results: 没有找到匹配 "${query}" 的文档（已按 tenantId=${ctx.tenantId} 在检索前过滤 ACL）`;
    }

    return JSON.stringify({
      query,
      tenantId: ctx.tenantId,
      topK,
      results,
    });
  },
};

const ticketIds = new Map<string, string>();
let ticketSequence = 0;

/**
 * 写操作 demo。
 *
 * isWrite 让 registry 强制要求 idempotencyKey；handler 再用同一个 key
 * 复用 ticketId，模拟真实系统的幂等表。
 */
export const createTicketTool: ToolDefinition = {
  spec: {
    name: "create_ticket",
    description:
      "创建一个人工工单。title 为 3 到 80 个字符，priority 只能是 low、normal 或 high。这是写操作，必须由用户明确确认（confirm=true）且调用方提供 idempotencyKey。相同 idempotencyKey 重试会返回同一个 ticketId，不会重复建单。",
    params: {
      title: {
        type: "string",
        description: "工单标题，3 到 80 个字符。",
        required: true,
        minLength: 3,
        maxLength: 80,
      },
      priority: {
        type: "string",
        description: "优先级，只能取 low、normal、high。",
        required: true,
        enum: ["low", "normal", "high"],
      },
      confirm: {
        type: "boolean",
        description: "用户是否已经明确确认创建工单；必须为 true。",
        required: true,
      },
    },
  },
  timeoutMs: 1000,
  isWrite: true,
  handler: async (args, ctx) => {
    const title = String(args.title ?? "");
    const priority = String(args.priority ?? "normal");

    if (args.confirm !== true) {
      throw new AppError(
        "policy",
        "creating a ticket requires explicit human confirmation; ask the user, then call again with confirm=true",
      );
    }
    if (!ctx.idempotencyKey) {
      throw new AppError("policy", "creating a ticket requires ctx.idempotencyKey");
    }

    const cacheKey = `${ctx.tenantId}:${ctx.idempotencyKey}`;
    const existing = ticketIds.get(cacheKey);
    if (existing) {
      return JSON.stringify({
        ticketId: existing,
        title,
        priority,
        status: "open",
        idempotentReplay: true,
      });
    }

    ticketSequence += 1;
    const ticketId = `TICKET-${String(ticketSequence).padStart(4, "0")}`;
    ticketIds.set(cacheKey, ticketId);
    return JSON.stringify({
      ticketId,
      title,
      priority,
      status: "open",
      idempotentReplay: false,
    });
  },
};

export const builtinTools: ToolDefinition[] = [
  calculatorTool,
  searchDocsTool,
  createTicketTool,
];
