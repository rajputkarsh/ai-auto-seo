import { describe, expect, it } from "vitest";
import { InMemoryPrOutcomeStore, type PrOutcomeStore } from "./outcomes";
import { createPrOutcomeStore } from "./outcomes-factory";
import { PrismaPrOutcomeStore, type PrOutcomePrismaLike } from "./prisma-outcomes";

/** In-memory fake of the structural client so the Prisma store logic runs for real. */
function fakeStore(): PrOutcomeStore {
  const rows: {
    id: string;
    orgId: string;
    repo: string;
    prNumber: number;
    url: string;
    issueType: string;
    state: string;
    openedAt: Date;
    resolvedAt: Date | null;
  }[] = [];
  let seq = 0;
  const client: PrOutcomePrismaLike = {
    prOutcome: {
      async create({ data }) {
        const row = { ...data, id: `pr_${++seq}` };
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
  return new PrismaPrOutcomeStore(client);
}

describe("createPrOutcomeStore", () => {
  it("returns the in-memory store without DATABASE_URL", async () => {
    expect(await createPrOutcomeStore({})).toBeInstanceOf(InMemoryPrOutcomeStore);
  });
});

describe("PrOutcome merge-rate is identical across implementations", () => {
  for (const [name, store] of [
    ["in-memory", new InMemoryPrOutcomeStore()],
    ["prisma", fakeStore()],
  ] as const) {
    it(`computes merge-rate-without-edits (${name})`, async () => {
      const base = {
        orgId: "acme",
        repo: "acme/site",
        url: "https://x/",
        issueType: "missing_canonical",
      };
      const a = await store.recordOpened({ ...base, prNumber: 1 });
      const b = await store.recordOpened({ ...base, prNumber: 2 });
      const c = await store.recordOpened({ ...base, prNumber: 3 });
      await store.recordOpened({ ...base, prNumber: 4 }); // stays open, excluded from ratio

      await store.resolve(a.id, "merged_unedited");
      await store.resolve(b.id, "merged_edited");
      await store.resolve(c.id, "dismissed");

      const rate = await store.mergeRate("acme");
      expect(rate.opened).toBe(4);
      expect(rate.merged).toBe(2);
      expect(rate.mergedUnedited).toBe(1);
      // 1 merged-unedited / 3 resolved.
      expect(rate.mergeRateWithoutEdits).toBeCloseTo(1 / 3);
      expect(await store.mergeRate("other")).toMatchObject({ opened: 0, mergeRateWithoutEdits: 0 });
    });
  }
});
