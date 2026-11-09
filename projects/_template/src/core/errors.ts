import type { ErrorCategory } from "./types.ts";

export type { ErrorCategory };

/**
 * 业务错误必须携带分类。分类决定重试、告警和给用户的提示，而不是靠字符串匹配。
 */
export class AppError extends Error {
  category: ErrorCategory;
  cause: unknown;

  constructor(category: ErrorCategory, message: string, cause?: unknown) {
    super(message);
    this.name = "AppError";
    this.category = category;
    this.cause = cause;
  }
}

export function isRetryable(category: ErrorCategory): boolean {
  return category === "transient";
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const candidate = err as { status?: unknown; statusCode?: unknown; response?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  if (typeof candidate.response === "object" && candidate.response !== null) {
    const response = candidate.response as { status?: unknown; statusCode?: unknown };
    if (typeof response.status === "number") return response.status;
    if (typeof response.statusCode === "number") return response.statusCode;
  }
  return undefined;
}

function categoryFromStatus(status: number): ErrorCategory {
  if (status === 429 || status === 408 || status >= 500) return "transient";
  if (status === 401 || status === 403) return "permission";
  if (status === 400 || status === 422) return "validation";
  return "permanent";
}

/**
 * 把任意异常归一成 6 类之一。
 *
 * 判断顺序很重要：AppError 的分类优先，其次是 HTTP 状态码，最后才是网络错误特征。
 */
export function categorize(err: unknown): ErrorCategory {
  if (err instanceof AppError) return err.category;

  const status = statusOf(err);
  if (status !== undefined) return categoryFromStatus(status);

  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name;
    if (name === "AbortError" || name === "TimeoutError") return "transient";
  }

  const message = err instanceof Error ? err.message : String(err);
  const httpStatus =
    /\bHTTP(?:\/\d(?:\.\d)?)?\s+(\d{3})\b/i.exec(message) ??
    /\bstatus\s*(?:code)?\s*[:=]?\s*(\d{3})\b/i.exec(message) ??
    /^(?:HTTP\s*)?(\d{3})\b/i.exec(message);
  if (httpStatus) return categoryFromStatus(Number(httpStatus[1]));

  if (/timeout|timed out|network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) {
    return "transient";
  }
  return "permanent";
}
