import { type BillingPrismaLike, PrismaSubscriptionStore, PrismaUsageMeter } from "./prisma";
import { InMemorySubscriptionStore, type SubscriptionStore } from "./subscription";
import { InMemoryUsageMeter, type UsageMeter } from "./usage";

export interface BillingStoreConfig {
  databaseUrl?: string;
}

export interface BillingStores {
  subscriptions: SubscriptionStore;
  usage: UsageMeter;
}

/**
 * Pick the billing stores from configuration.
 *
 * Both stores share one Prisma client, so this is a combined factory rather than
 * two — constructing the client twice would open two connection pools for no
 * reason. Same rule as the scan store: DATABASE_URL present → Postgres, absent →
 * in-memory, and the choice is config, not code. Prisma is imported lazily so
 * callers that never touch a database need no generated client on disk.
 */
export async function createBillingStores(config: BillingStoreConfig): Promise<BillingStores> {
  if (!config.databaseUrl) {
    return { subscriptions: new InMemorySubscriptionStore(), usage: new InMemoryUsageMeter() };
  }

  let PrismaClient: new () => BillingPrismaLike;
  try {
    ({ PrismaClient } = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => BillingPrismaLike;
    });
  } catch (cause) {
    throw new Error(
      "DATABASE_URL is set but the Prisma client is not generated. Run `pnpm --filter @awe/persistence db:generate`.",
      { cause },
    );
  }

  const client = new PrismaClient();
  return {
    subscriptions: new PrismaSubscriptionStore(client),
    usage: new PrismaUsageMeter(client),
  };
}
