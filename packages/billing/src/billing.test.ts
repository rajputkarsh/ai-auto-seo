import { describe, expect, it } from "vitest";
import { QuotaGuard } from "./guard";
import { InMemorySubscriptionStore } from "./subscription";
import { entitlementsFor, isTier, TIERS } from "./tiers";
import { InMemoryUsageMeter, periodKey } from "./usage";

describe("tiers", () => {
  it("free is the most limited, enterprise is unlimited", () => {
    expect(TIERS.free.maxScansPerMonth).toBeLessThan(TIERS.pro.maxScansPerMonth ?? Infinity);
    expect(TIERS.enterprise.maxScansPerMonth).toBeNull();
    expect(TIERS.enterprise.maxProperties).toBeNull();
  });

  it("recognises valid tier names", () => {
    expect(isTier("pro")).toBe(true);
    expect(isTier("platinum")).toBe(false);
  });

  it("applies per-org overrides on top of the tier default", () => {
    const e = entitlementsFor("free", { maxScansPerMonth: 500 });
    expect(e.maxScansPerMonth).toBe(500);
    expect(e.maxProperties).toBe(TIERS.free.maxProperties); // untouched
    expect(e.tier).toBe("free");
  });
});

describe("usage meter", () => {
  it("accumulates within a month", async () => {
    const meter = new InMemoryUsageMeter();
    const at = new Date("2026-03-10T00:00:00Z");
    await meter.record("org1", { scans: 1, pagesCrawled: 5, llmCostCents: 3 }, at);
    await meter.record("org1", { scans: 1, pagesCrawled: 2 }, at);
    expect(await meter.current("org1", at)).toEqual({ scans: 2, pagesCrawled: 7, llmCostCents: 3 });
  });

  it("resets across month boundaries", async () => {
    const meter = new InMemoryUsageMeter();
    await meter.record("org1", { scans: 5 }, new Date("2026-03-31T23:59:59Z"));
    expect((await meter.current("org1", new Date("2026-04-01T00:00:00Z"))).scans).toBe(0);
  });

  it("isolates orgs", async () => {
    const meter = new InMemoryUsageMeter();
    const at = new Date("2026-03-10");
    await meter.record("a", { scans: 3 }, at);
    expect((await meter.current("b", at)).scans).toBe(0);
  });

  it("keys periods as YYYY-MM in UTC", () => {
    expect(periodKey(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01");
    expect(periodKey(new Date("2026-12-05T12:00:00Z"))).toBe("2026-12");
  });
});

describe("QuotaGuard", () => {
  const setup = () => {
    const subs = new InMemorySubscriptionStore();
    const usage = new InMemoryUsageMeter();
    return { subs, usage, guard: new QuotaGuard(subs, usage) };
  };

  it("allows a brand-new org on the implicit free tier", async () => {
    const { guard } = setup();
    const decision = await guard.check("new-org");
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.maxPagesPerScan).toBe(TIERS.free.maxPagesPerScan);
  });

  it("blocks a suspended org", async () => {
    const { subs, guard } = setup();
    await subs.set({ orgId: "bad", tier: "pro", suspended: true });
    const decision = await guard.check("bad");
    expect(decision).toEqual(expect.objectContaining({ allowed: false, reason: "suspended" }));
  });

  it("blocks once the monthly scan quota is reached", async () => {
    const { usage, guard } = setup();
    const at = new Date("2026-03-10");
    // Free tier allows 30/month; consume them.
    for (let i = 0; i < TIERS.free.maxScansPerMonth!; i++) {
      await usage.record("org1", { scans: 1 }, at);
    }
    const decision = await guard.check("org1", at);
    expect(decision).toEqual(
      expect.objectContaining({ allowed: false, reason: "scan_quota_exceeded" }),
    );
  });

  it("lets a higher tier past the free limit", async () => {
    const { subs, usage, guard } = setup();
    await subs.set({ orgId: "paid", tier: "pro", suspended: false });
    const at = new Date("2026-03-10");
    for (let i = 0; i < 40; i++) await usage.record("paid", { scans: 1 }, at); // > free's 30
    const decision = await guard.check("paid", at);
    expect(decision.allowed).toBe(true);
  });

  it("respects a per-org override that raises the limit", async () => {
    const { subs, usage, guard } = setup();
    await subs.set({
      orgId: "comped",
      tier: "free",
      suspended: false,
      overrides: { maxScansPerMonth: 100 },
    });
    const at = new Date("2026-03-10");
    for (let i = 0; i < 50; i++) await usage.record("comped", { scans: 1 }, at);
    expect((await guard.check("comped", at)).allowed).toBe(true);
  });

  it("never records usage itself — a denied check leaves counters untouched", async () => {
    const { subs, usage, guard } = setup();
    await subs.set({ orgId: "bad", tier: "free", suspended: true });
    await guard.check("bad");
    expect((await usage.current("bad")).scans).toBe(0);
  });
});
