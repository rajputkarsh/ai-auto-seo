export interface UsagePeriod {
  scans: number;
  pagesCrawled: number;
  llmCostCents: number;
}

const EMPTY: UsagePeriod = { scans: 0, pagesCrawled: 0, llmCostCents: 0 };

/** The calendar month an instant falls in, as `YYYY-MM`. Quotas reset monthly. */
export function periodKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface UsageMeter {
  record(orgId: string, delta: Partial<UsagePeriod>, at?: Date): Promise<void>;
  current(orgId: string, at?: Date): Promise<UsagePeriod>;
}

/**
 * In-memory usage meter, keyed by (org, month).
 *
 * The default so quota enforcement works before a datastore exists; a
 * Postgres-backed meter implements the same interface. Counters accumulate; the
 * period key rolls over automatically at month boundaries.
 */
export class InMemoryUsageMeter implements UsageMeter {
  private readonly usage = new Map<string, UsagePeriod>();

  async record(orgId: string, delta: Partial<UsagePeriod>, at: Date = new Date()): Promise<void> {
    const key = `${orgId}:${periodKey(at)}`;
    const existing = this.usage.get(key) ?? { ...EMPTY };
    this.usage.set(key, {
      scans: existing.scans + (delta.scans ?? 0),
      pagesCrawled: existing.pagesCrawled + (delta.pagesCrawled ?? 0),
      llmCostCents: existing.llmCostCents + (delta.llmCostCents ?? 0),
    });
  }

  async current(orgId: string, at: Date = new Date()): Promise<UsagePeriod> {
    return { ...(this.usage.get(`${orgId}:${periodKey(at)}`) ?? EMPTY) };
  }

  clear(): void {
    this.usage.clear();
  }
}
