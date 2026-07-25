import { describe, expect, it } from "vitest";
import { createBillingStores } from "./factory";
import { type BillingPrismaLike, PrismaSubscriptionStore, PrismaUsageMeter } from "./prisma";
import { InMemorySubscriptionStore } from "./subscription";
import { InMemoryUsageMeter } from "./usage";

/**
 * A minimal in-memory fake of the structural Prisma client, so the Prisma store
 * logic (row mapping, atomic increments, upsert-or-create) is exercised for real
 * without a database. If the fake and the real client ever diverge, the
 * structural `BillingPrismaLike` type is what catches it at compile time.
 */
function fakeClient(): BillingPrismaLike {
  const subs = new Map<
    string,
    { orgId: string; tier: string; suspended: boolean; overrides: unknown }
  >();
  const usage = new Map<string, { scans: number; pagesCrawled: number; llmCostCents: number }>();
  const key = (o: string, p: string) => `${o}:${p}`;
  return {
    subscription: {
      async findUnique({ where }) {
        return subs.get(where.orgId) ?? null;
      },
      async upsert({ where, create, update }) {
        const existing = subs.get(where.orgId);
        subs.set(where.orgId, existing ? { ...existing, ...update } : create);
        return {};
      },
      async findMany() {
        return [...subs.values()];
      },
    },
    usagePeriod: {
      async findUnique({ where }) {
        return usage.get(key(where.orgId_period.orgId, where.orgId_period.period)) ?? null;
      },
      async upsert({ where, create, update }) {
        const k = key(where.orgId_period.orgId, where.orgId_period.period);
        const cur = usage.get(k);
        if (!cur) {
          usage.set(k, {
            scans: create.scans,
            pagesCrawled: create.pagesCrawled,
            llmCostCents: create.llmCostCents,
          });
        } else {
          usage.set(k, {
            scans: cur.scans + update.scans.increment,
            pagesCrawled: cur.pagesCrawled + update.pagesCrawled.increment,
            llmCostCents: cur.llmCostCents + update.llmCostCents.increment,
          });
        }
        return {};
      },
    },
  };
}

describe("createBillingStores", () => {
  it("returns in-memory stores when no DATABASE_URL is configured", async () => {
    const { subscriptions, usage } = await createBillingStores({});
    expect(subscriptions).toBeInstanceOf(InMemorySubscriptionStore);
    expect(usage).toBeInstanceOf(InMemoryUsageMeter);
  });
});

describe("PrismaSubscriptionStore matches the in-memory contract", () => {
  it("treats an unknown org as Free, then round-trips explicit state", async () => {
    const store = new PrismaSubscriptionStore(fakeClient());
    expect(await store.get("new-org")).toEqual({
      orgId: "new-org",
      tier: "free",
      suspended: false,
    });

    await store.set({
      orgId: "acme",
      tier: "pro",
      suspended: false,
      overrides: { maxScansPerMonth: 5000 },
    });
    const got = await store.get("acme");
    expect(got.tier).toBe("pro");
    expect(got.overrides).toEqual({ maxScansPerMonth: 5000 });
    expect(await store.list()).toHaveLength(1);
  });

  it("narrows an unknown tier string back to Free", async () => {
    const client = fakeClient();
    await client.subscription.upsert({
      where: { orgId: "x" },
      create: { orgId: "x", tier: "bogus", suspended: false, overrides: null },
      update: { tier: "bogus", suspended: false, overrides: null },
    });
    expect((await new PrismaSubscriptionStore(client).get("x")).tier).toBe("free");
  });
});

describe("PrismaUsageMeter matches the in-memory contract", () => {
  it("accumulates within a period and isolates by month", async () => {
    const jan = new Date(Date.UTC(2026, 0, 15));
    const feb = new Date(Date.UTC(2026, 1, 15));
    for (const meter of [new InMemoryUsageMeter(), new PrismaUsageMeter(fakeClient())]) {
      await meter.record("acme", { scans: 2, pagesCrawled: 10 }, jan);
      await meter.record("acme", { scans: 3, llmCostCents: 40 }, jan);
      await meter.record("acme", { scans: 1 }, feb);
      expect(await meter.current("acme", jan)).toEqual({
        scans: 5,
        pagesCrawled: 10,
        llmCostCents: 40,
      });
      expect((await meter.current("acme", feb)).scans).toBe(1);
    }
  });
});
