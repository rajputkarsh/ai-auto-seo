export type OutcomeState = "opened" | "merged_unedited" | "merged_edited" | "dismissed";

export interface PrOutcome {
  id: string;
  orgId: string;
  repo: string;
  prNumber: number;
  url: string;
  issueType: string;
  state: OutcomeState;
  openedAt: Date;
  resolvedAt?: Date;
}

export interface MergeRate {
  opened: number;
  merged: number;
  mergedUnedited: number;
  dismissed: number;
  /** merged-unedited / resolved. The North-Star metric and the Phase-3 exit gate. */
  mergeRateWithoutEdits: number;
}

export interface RecordPrInput {
  orgId: string;
  repo: string;
  prNumber: number;
  url: string;
  issueType: string;
  openedAt?: Date;
}

/**
 * Tracks the fate of every PR the repo rail opens, and computes
 * merge-rate-without-edits — the metric that gates Phase-3 scope expansion.
 *
 * Why "without edits" is the number that matters: a merged-but-edited PR means
 * the generated fix was close but not trusted enough to take as-is. Only a PR
 * merged *unchanged* proves the fix was mergeable. So the denominator is
 * resolved PRs, and the numerator is merged-unedited alone.
 */
export interface PrOutcomeStore {
  recordOpened(input: RecordPrInput): Promise<PrOutcome>;
  resolve(id: string, state: Exclude<OutcomeState, "opened">, at?: Date): Promise<void>;
  mergeRate(orgId?: string): Promise<MergeRate>;
  list(orgId?: string): Promise<PrOutcome[]>;
}

export class InMemoryPrOutcomeStore implements PrOutcomeStore {
  private readonly outcomes = new Map<string, PrOutcome>();
  private sequence = 0;

  async recordOpened(input: RecordPrInput): Promise<PrOutcome> {
    const outcome: PrOutcome = {
      id: `pr_${++this.sequence}`,
      orgId: input.orgId,
      repo: input.repo,
      prNumber: input.prNumber,
      url: input.url,
      issueType: input.issueType,
      state: "opened",
      openedAt: input.openedAt ?? new Date(),
    };
    this.outcomes.set(outcome.id, outcome);
    return outcome;
  }

  async resolve(id: string, state: Exclude<OutcomeState, "opened">, at?: Date): Promise<void> {
    const outcome = this.outcomes.get(id);
    if (!outcome) throw new Error(`unknown PR outcome: ${id}`);
    outcome.state = state;
    outcome.resolvedAt = at ?? new Date();
  }

  async mergeRate(orgId?: string): Promise<MergeRate> {
    const rows = [...this.outcomes.values()].filter((o) => !orgId || o.orgId === orgId);
    const mergedUnedited = rows.filter((o) => o.state === "merged_unedited").length;
    const mergedEdited = rows.filter((o) => o.state === "merged_edited").length;
    const dismissed = rows.filter((o) => o.state === "dismissed").length;
    const resolved = mergedUnedited + mergedEdited + dismissed;
    return {
      opened: rows.length,
      merged: mergedUnedited + mergedEdited,
      mergedUnedited,
      dismissed,
      // No resolved PRs yet → report 0, not NaN.
      mergeRateWithoutEdits: resolved === 0 ? 0 : mergedUnedited / resolved,
    };
  }

  async list(orgId?: string): Promise<PrOutcome[]> {
    return [...this.outcomes.values()].filter((o) => !orgId || o.orgId === orgId);
  }
}
