import { InMemoryPrOutcomeStore, type PrOutcomeStore } from "./outcomes";
import { PrismaPrOutcomeStore, type PrOutcomePrismaLike } from "./prisma-outcomes";

export interface OutcomeStoreConfig {
  databaseUrl?: string;
}

/**
 * Pick the PR-outcome store from configuration — DATABASE_URL present → Postgres,
 * absent → in-memory. Same lazy-import discipline as the scan store so callers
 * without a database need no generated Prisma client.
 */
export async function createPrOutcomeStore(config: OutcomeStoreConfig): Promise<PrOutcomeStore> {
  if (!config.databaseUrl) return new InMemoryPrOutcomeStore();

  let PrismaClient: new () => PrOutcomePrismaLike;
  try {
    ({ PrismaClient } = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => PrOutcomePrismaLike;
    });
  } catch (cause) {
    throw new Error(
      "DATABASE_URL is set but the Prisma client is not generated. Run `pnpm --filter @awe/persistence db:generate`.",
      { cause },
    );
  }

  return new PrismaPrOutcomeStore(new PrismaClient());
}
