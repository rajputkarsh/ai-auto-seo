import type { Subscription, SubscriptionStore } from "./subscription";
import { isTier } from "./tiers";
import { periodKey, type UsageMeter, type UsagePeriod } from "./usage";

/**
 * The subset of the generated Prisma client the billing stores use.
 *
 * Declared structurally (not imported from `@prisma/client`) so this package
 * typechecks and tests without anyone running `prisma generate` — the generated
 * client is only needed to actually talk to Postgres, at deploy time.
 */
export interface BillingPrismaLike {
  subscription: {
    findUnique(args: {
      where: { orgId: string };
    }): Promise<{ orgId: string; tier: string; suspended: boolean; overrides: unknown } | null>;
    upsert(args: {
      where: { orgId: string };
      create: { orgId: string; tier: string; suspended: boolean; overrides: unknown };
      update: { tier: string; suspended: boolean; overrides: unknown };
    }): Promise<unknown>;
    findMany(): Promise<{ orgId: string; tier: string; suspended: boolean; overrides: unknown }[]>;
  };
  usagePeriod: {
    findUnique(args: {
      where: { orgId_period: { orgId: string; period: string } };
    }): Promise<{ scans: number; pagesCrawled: number; llmCostCents: number } | null>;
    upsert(args: {
      where: { orgId_period: { orgId: string; period: string } };
      create: {
        orgId: string;
        period: string;
        scans: number;
        pagesCrawled: number;
        llmCostCents: number;
      };
      update: {
        scans: { increment: number };
        pagesCrawled: { increment: number };
        llmCostCents: { increment: number };
      };
    }): Promise<unknown>;
  };
}

/** A DB row's `tier` string, narrowed back to the `Tier` union (Free if invalid). */
function rowToSubscription(row: {
  orgId: string;
  tier: string;
  suspended: boolean;
  overrides: unknown;
}): Subscription {
  const tier = isTier(row.tier) ? row.tier : "free";
  return {
    orgId: row.orgId,
    tier,
    suspended: row.suspended,
    ...(row.overrides ? { overrides: row.overrides as Subscription["overrides"] } : {}),
  };
}

/**
 * Postgres-backed subscriptions. Mirrors `InMemorySubscriptionStore`: an org
 * with no row is Free (not an error), so only explicit non-default state is
 * persisted.
 */
export class PrismaSubscriptionStore implements SubscriptionStore {
  constructor(private readonly prisma: BillingPrismaLike) {}

  async get(orgId: string): Promise<Subscription> {
    const row = await this.prisma.subscription.findUnique({ where: { orgId } });
    return row ? rowToSubscription(row) : { orgId, tier: "free", suspended: false };
  }

  async set(sub: Subscription): Promise<void> {
    const overrides = sub.overrides ?? null;
    await this.prisma.subscription.upsert({
      where: { orgId: sub.orgId },
      create: { orgId: sub.orgId, tier: sub.tier, suspended: sub.suspended, overrides },
      update: { tier: sub.tier, suspended: sub.suspended, overrides },
    });
  }

  async list(): Promise<Subscription[]> {
    return (await this.prisma.subscription.findMany()).map(rowToSubscription);
  }
}

/**
 * Postgres-backed usage meter, keyed by (org, month). Mirrors
 * `InMemoryUsageMeter`: counters accumulate via atomic increments and the
 * period key rolls over at month boundaries.
 */
export class PrismaUsageMeter implements UsageMeter {
  constructor(private readonly prisma: BillingPrismaLike) {}

  async record(orgId: string, delta: Partial<UsagePeriod>, at: Date = new Date()): Promise<void> {
    const period = periodKey(at);
    const scans = delta.scans ?? 0;
    const pagesCrawled = delta.pagesCrawled ?? 0;
    const llmCostCents = delta.llmCostCents ?? 0;
    await this.prisma.usagePeriod.upsert({
      where: { orgId_period: { orgId, period } },
      create: { orgId, period, scans, pagesCrawled, llmCostCents },
      update: {
        scans: { increment: scans },
        pagesCrawled: { increment: pagesCrawled },
        llmCostCents: { increment: llmCostCents },
      },
    });
  }

  async current(orgId: string, at: Date = new Date()): Promise<UsagePeriod> {
    const row = await this.prisma.usagePeriod.findUnique({
      where: { orgId_period: { orgId, period: periodKey(at) } },
    });
    return {
      scans: row?.scans ?? 0,
      pagesCrawled: row?.pagesCrawled ?? 0,
      llmCostCents: row?.llmCostCents ?? 0,
    };
  }
}
