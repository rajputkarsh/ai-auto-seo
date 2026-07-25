import { describe, expect, it } from "vitest";
import { type CmsOutcomeStore, InMemoryCmsOutcomeStore } from "./outcomes";
import { createCmsOutcomeStore } from "./outcomes-factory";
import { type CmsOutcomePrismaLike, PrismaCmsOutcomeStore } from "./prisma-outcomes";

/** In-memory fake of the structural client so the Prisma store logic runs for real. */
function fakeStore(): CmsOutcomeStore {
  const rows: {
    id: string;
    orgId: string;
    url: string;
    issueType: string;
    kind: string;
    state: string;
    reviewUrl: string | null;
    at: Date;
  }[] = [];
  let seq = 0;
  const client: CmsOutcomePrismaLike = {
    cmsOutcome: {
      async create({ data }) {
        const row = { ...data, id: `cms_${++seq}` };
        rows.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return {};
      },
      async findMany({ where }) {
        return rows.filter((r) => !where.orgId || r.orgId === where.orgId);
      },
    },
  };
  return new PrismaCmsOutcomeStore(client);
}

describe("createCmsOutcomeStore", () => {
  it("returns the in-memory store without DATABASE_URL", async () => {
    expect(await createCmsOutcomeStore({})).toBeInstanceOf(InMemoryCmsOutcomeStore);
  });
});

describe("CMS applied-fix rate is identical across implementations", () => {
  for (const [name, store] of [
    ["in-memory", new InMemoryCmsOutcomeStore()],
    ["prisma", fakeStore()],
  ] as const) {
    it(`counts only resolved drafts (${name})`, async () => {
      const base = {
        orgId: "acme",
        url: "https://x/",
        issueType: "missing_canonical",
        kind: "title",
      };
      const a = await store.recordDraft(base);
      const b = await store.recordDraft(base);
      await store.recordDraft(base); // stays drafted, excluded from ratio

      await store.resolve(a.id, "applied");
      await store.resolve(b.id, "dismissed");

      const rate = await store.appliedFixRate("acme");
      expect(rate.drafted).toBe(1);
      expect(rate.applied).toBe(1);
      expect(rate.dismissed).toBe(1);
      // 1 applied / 2 resolved.
      expect(rate.appliedFixRate).toBeCloseTo(0.5);
      expect(await store.appliedFixRate("other")).toMatchObject({ applied: 0, appliedFixRate: 0 });
    });
  }
});
