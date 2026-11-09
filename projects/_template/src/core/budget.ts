import { AppError } from "./errors.ts";

export interface BudgetOptions {
  maxSteps: number;
  maxCostUsd: number;
  maxWallMs: number;
  now?: () => number;
}

export interface BudgetSnapshot {
  steps: number;
  maxSteps: number;
  costUsd: number;
  maxCostUsd: number;
  elapsedMs: number;
  maxWallMs: number;
  remainingUsd: number;
  remainingMs: number;
}

/**
 * 一次 agent 运行的硬预算。任何边界被突破都抛 budget 错误，
 * 由 agent loop 转成可返回的 RunResult，而不是让进程崩溃。
 */
export class Budget {
  maxSteps: number;
  maxCostUsd: number;
  maxWallMs: number;
  now: () => number;
  startedAt: number;
  currentSteps: number;
  currentCostUsd: number;

  constructor(options: BudgetOptions) {
    if (options.maxSteps < 0) throw new AppError("budget", "maxSteps must not be negative");
    if (options.maxCostUsd < 0) throw new AppError("budget", "maxCostUsd must not be negative");
    if (options.maxWallMs < 0) throw new AppError("budget", "maxWallMs must not be negative");
    this.maxSteps = options.maxSteps;
    this.maxCostUsd = options.maxCostUsd;
    this.maxWallMs = options.maxWallMs;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.currentSteps = 0;
    this.currentCostUsd = 0;
  }

  step(): void {
    this.currentSteps += 1;
    if (this.currentSteps > this.maxSteps) {
      throw new AppError(
        "budget",
        `step budget exhausted: ${this.currentSteps} > ${this.maxSteps}`,
      );
    }
  }

  spend(usd: number): void {
    if (!Number.isFinite(usd) || usd < 0) {
      throw new AppError("budget", `invalid cost: ${String(usd)}`);
    }
    this.currentCostUsd += usd;
    if (this.currentCostUsd > this.maxCostUsd) {
      throw new AppError(
        "budget",
        `cost budget exhausted: ${this.currentCostUsd.toFixed(6)} > ${this.maxCostUsd.toFixed(6)} USD`,
      );
    }
  }

  checkWallClock(): void {
    if (this.elapsedMs > this.maxWallMs) {
      throw new AppError(
        "budget",
        `wall-clock budget exhausted: ${this.elapsedMs}ms > ${this.maxWallMs}ms`,
      );
    }
  }

  get steps(): number {
    return this.currentSteps;
  }

  get costUsd(): number {
    return this.currentCostUsd;
  }

  get elapsedMs(): number {
    return Math.max(0, this.now() - this.startedAt);
  }

  get remainingUsd(): number {
    return Math.max(0, this.maxCostUsd - this.currentCostUsd);
  }

  get remainingMs(): number {
    return Math.max(0, this.maxWallMs - this.elapsedMs);
  }

  snapshot(): BudgetSnapshot {
    return {
      steps: this.currentSteps,
      maxSteps: this.maxSteps,
      costUsd: this.currentCostUsd,
      maxCostUsd: this.maxCostUsd,
      elapsedMs: this.elapsedMs,
      maxWallMs: this.maxWallMs,
      remainingUsd: this.remainingUsd,
      remainingMs: this.remainingMs,
    };
  }
}
