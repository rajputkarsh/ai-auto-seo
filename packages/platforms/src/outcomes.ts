export type CmsOutcomeState = "drafted" | "applied" | "dismissed";

export interface CmsOutcome {
  id: string;
  orgId: string;
  url: string;
  issueType: string;
  kind: string;
  state: CmsOutcomeState;
  reviewUrl?: string;
  at: Date;
}

export interface AppliedFixRate {
  drafted: number;
  applied: number;
  dismissed: number;
  /** applied / resolved (applied + dismissed). Open drafts are excluded. */
  appliedFixRate: number;
}

/**
 * Tracks the fate of CMS drafts so the applied-fix rate can be measured — the
 * Phase-4 health metric mirroring Phase-3's merge-rate. Only resolved drafts
 * count toward the ratio (an approved change is `applied`, a rejected one is
 * `dismissed`); a still-pending draft is reported but excluded from the rate.
 */
export interface CmsOutcomeStore {
  recordDraft(input: Omit<CmsOutcome, "id" | "state" | "at"> & { at?: Date }): Promise<CmsOutcome>;
  resolve(id: string, state: Exclude<CmsOutcomeState, "drafted">, at?: Date): Promise<void>;
  appliedFixRate(orgId?: string): Promise<AppliedFixRate>;
  list(orgId?: string): Promise<CmsOutcome[]>;
}

export class InMemoryCmsOutcomeStore implements CmsOutcomeStore {
  private readonly outcomes = new Map<string, CmsOutcome>();
  private sequence = 0;

  async recordDraft(
    input: Omit<CmsOutcome, "id" | "state" | "at"> & { at?: Date },
  ): Promise<CmsOutcome> {
    const outcome: CmsOutcome = {
      id: `cms_${++this.sequence}`,
      state: "drafted",
      at: input.at ?? new Date(),
      orgId: input.orgId,
      url: input.url,
      issueType: input.issueType,
      kind: input.kind,
      ...(input.reviewUrl ? { reviewUrl: input.reviewUrl } : {}),
    };
    this.outcomes.set(outcome.id, outcome);
    return outcome;
  }

  async resolve(id: string, state: Exclude<CmsOutcomeState, "drafted">, at?: Date): Promise<void> {
    const outcome = this.outcomes.get(id);
    if (!outcome) throw new Error(`unknown CMS outcome: ${id}`);
    outcome.state = state;
    outcome.at = at ?? new Date();
  }

  async appliedFixRate(orgId?: string): Promise<AppliedFixRate> {
    const rows = [...this.outcomes.values()].filter((o) => !orgId || o.orgId === orgId);
    const applied = rows.filter((o) => o.state === "applied").length;
    const dismissed = rows.filter((o) => o.state === "dismissed").length;
    const resolved = applied + dismissed;
    return {
      drafted: rows.filter((o) => o.state === "drafted").length,
      applied,
      dismissed,
      appliedFixRate: resolved === 0 ? 0 : applied / resolved,
    };
  }

  async list(orgId?: string): Promise<CmsOutcome[]> {
    return [...this.outcomes.values()].filter((o) => !orgId || o.orgId === orgId);
  }
}
