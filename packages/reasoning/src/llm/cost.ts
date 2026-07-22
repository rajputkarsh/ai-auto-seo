export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelPricing {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
}

/**
 * Published per-million-token pricing. The whole margin thesis rests on routing
 * high-volume work to the cheap model and reserving the capable one for
 * generation, so the ratio here is the number that matters.
 */
export const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

/** Cost of one call, in cents. Unknown models are priced at the most expensive rate. */
export function costCents(model: string, usage: TokenUsage): number {
  const pricing = PRICING[model] ?? { inputPerMTok: 5, outputPerMTok: 25 };
  const dollars =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok;
  return dollars * 100;
}

/**
 * Enforces a spend ceiling and records what every call actually cost.
 *
 * Fail-closed: once the budget is exhausted the reasoner falls back to the
 * deterministic path rather than erroring, so a blown budget degrades quality
 * instead of breaking the product.
 */
export class CostGovernor {
  private spent = 0;
  private calls = 0;

  constructor(private readonly budgetCents: number) {}

  get spentCents(): number {
    return this.spent;
  }

  get callCount(): number {
    return this.calls;
  }

  get remainingCents(): number {
    return Math.max(0, this.budgetCents - this.spent);
  }

  /**
   * Whether another call is permitted, optionally reserving an estimate.
   *
   * Requires strictly positive remaining budget, so an exactly-exhausted (or
   * zero) budget blocks further calls rather than permitting one more.
   */
  canAfford(estimateCents = 0): boolean {
    return this.remainingCents > 0 && this.spent + estimateCents <= this.budgetCents;
  }

  /** Record a completed call and return what it cost. */
  record(model: string, usage: TokenUsage): number {
    const cents = costCents(model, usage);
    this.spent += cents;
    this.calls += 1;
    return cents;
  }
}
