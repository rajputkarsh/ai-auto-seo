import type { AppliedFixRate, CmsOutcome, CmsOutcomeState, CmsOutcomeStore } from "./outcomes";

/**
 * The subset of the generated Prisma client the CMS-outcome store uses.
 *
 * Structural (not imported from `@prisma/client`) so the package typechecks and
 * tests with no generated client; the real client is only needed at deploy time.
 */
export interface CmsOutcomePrismaLike {
  cmsOutcome: {
    create(args: { data: Omit<CmsOutcomeRow, "id"> }): Promise<CmsOutcomeRow>;
    update(args: { where: { id: string }; data: { state: string; at: Date } }): Promise<unknown>;
    findMany(args: { where: { orgId?: string } }): Promise<CmsOutcomeRow[]>;
  };
}

interface CmsOutcomeRow {
  id: string;
  orgId: string;
  url: string;
  issueType: string;
  kind: string;
  state: string;
  reviewUrl: string | null;
  at: Date;
}

function rowToOutcome(row: CmsOutcomeRow): CmsOutcome {
  return {
    id: row.id,
    orgId: row.orgId,
    url: row.url,
    issueType: row.issueType,
    kind: row.kind,
    state: row.state as CmsOutcomeState,
    at: row.at,
    ...(row.reviewUrl ? { reviewUrl: row.reviewUrl } : {}),
  };
}

/**
 * Postgres-backed CMS-outcome tracking. Mirrors `InMemoryCmsOutcomeStore`
 * exactly, including how `appliedFixRate` counts only resolved drafts (applied +
 * dismissed) toward the ratio and excludes still-pending drafts.
 */
export class PrismaCmsOutcomeStore implements CmsOutcomeStore {
  constructor(private readonly prisma: CmsOutcomePrismaLike) {}

  async recordDraft(
    input: Omit<CmsOutcome, "id" | "state" | "at"> & { at?: Date },
  ): Promise<CmsOutcome> {
    // id is DB-defaulted (cuid); a fresh row always starts "drafted".
    const row = await this.prisma.cmsOutcome.create({
      data: {
        orgId: input.orgId,
        url: input.url,
        issueType: input.issueType,
        kind: input.kind,
        state: "drafted",
        reviewUrl: input.reviewUrl ?? null,
        at: input.at ?? new Date(),
      },
    });
    return rowToOutcome(row);
  }

  async resolve(id: string, state: Exclude<CmsOutcomeState, "drafted">, at?: Date): Promise<void> {
    await this.prisma.cmsOutcome.update({
      where: { id },
      data: { state, at: at ?? new Date() },
    });
  }

  async appliedFixRate(orgId?: string): Promise<AppliedFixRate> {
    const rows = await this.prisma.cmsOutcome.findMany({ where: orgId ? { orgId } : {} });
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
    const rows = await this.prisma.cmsOutcome.findMany({ where: orgId ? { orgId } : {} });
    return rows.map(rowToOutcome);
  }
}
