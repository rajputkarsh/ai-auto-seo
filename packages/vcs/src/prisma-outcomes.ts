import type { MergeRate, OutcomeState, PrOutcome, PrOutcomeStore, RecordPrInput } from "./outcomes";

/**
 * The subset of the generated Prisma client the PR-outcome store uses.
 *
 * Structural (not imported from `@prisma/client`) so the package typechecks and
 * tests without a generated client; the real client is only needed at deploy
 * time when DATABASE_URL is set.
 */
export interface PrOutcomePrismaLike {
  prOutcome: {
    create(args: { data: Omit<PrOutcomeRow, "id"> }): Promise<PrOutcomeRow>;
    update(args: {
      where: { id: string };
      data: { state: string; resolvedAt: Date };
    }): Promise<unknown>;
    findMany(args: { where: { orgId?: string } }): Promise<PrOutcomeRow[]>;
  };
}

interface PrOutcomeRow {
  id: string;
  orgId: string;
  repo: string;
  prNumber: number;
  url: string;
  issueType: string;
  state: string;
  openedAt: Date;
  resolvedAt: Date | null;
}

function rowToOutcome(row: PrOutcomeRow): PrOutcome {
  return {
    id: row.id,
    orgId: row.orgId,
    repo: row.repo,
    prNumber: row.prNumber,
    url: row.url,
    issueType: row.issueType,
    state: row.state as OutcomeState,
    openedAt: row.openedAt,
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt } : {}),
  };
}

/**
 * Postgres-backed PR-outcome tracking. Mirrors `InMemoryPrOutcomeStore` exactly,
 * including how `mergeRate` derives merge-rate-without-edits (resolved PRs as the
 * denominator, merged-unedited alone as the numerator).
 */
export class PrismaPrOutcomeStore implements PrOutcomeStore {
  constructor(private readonly prisma: PrOutcomePrismaLike) {}

  async recordOpened(input: RecordPrInput): Promise<PrOutcome> {
    const row = await this.prisma.prOutcome.create({
      // id is DB-defaulted (cuid); a fresh row always starts "opened".
      data: {
        orgId: input.orgId,
        repo: input.repo,
        prNumber: input.prNumber,
        url: input.url,
        issueType: input.issueType,
        state: "opened",
        openedAt: input.openedAt ?? new Date(),
        resolvedAt: null,
      },
    });
    return rowToOutcome(row);
  }

  async resolve(id: string, state: Exclude<OutcomeState, "opened">, at?: Date): Promise<void> {
    await this.prisma.prOutcome.update({
      where: { id },
      data: { state, resolvedAt: at ?? new Date() },
    });
  }

  async mergeRate(orgId?: string): Promise<MergeRate> {
    const rows = await this.prisma.prOutcome.findMany({ where: orgId ? { orgId } : {} });
    const mergedUnedited = rows.filter((o) => o.state === "merged_unedited").length;
    const mergedEdited = rows.filter((o) => o.state === "merged_edited").length;
    const dismissed = rows.filter((o) => o.state === "dismissed").length;
    const resolved = mergedUnedited + mergedEdited + dismissed;
    return {
      opened: rows.length,
      merged: mergedUnedited + mergedEdited,
      mergedUnedited,
      dismissed,
      mergeRateWithoutEdits: resolved === 0 ? 0 : mergedUnedited / resolved,
    };
  }

  async list(orgId?: string): Promise<PrOutcome[]> {
    const rows = await this.prisma.prOutcome.findMany({ where: orgId ? { orgId } : {} });
    return rows.map(rowToOutcome);
  }
}
