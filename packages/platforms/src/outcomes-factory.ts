import { type CmsOutcomeStore, InMemoryCmsOutcomeStore } from "./outcomes";
import { type CmsOutcomePrismaLike, PrismaCmsOutcomeStore } from "./prisma-outcomes";

export interface CmsOutcomeStoreConfig {
  databaseUrl?: string;
}

/**
 * Pick the CMS-outcome store from configuration — DATABASE_URL present →
 * Postgres, absent → in-memory. Prisma is imported lazily so callers without a
 * database need no generated client.
 */
export async function createCmsOutcomeStore(
  config: CmsOutcomeStoreConfig,
): Promise<CmsOutcomeStore> {
  if (!config.databaseUrl) return new InMemoryCmsOutcomeStore();

  let PrismaClient: new () => CmsOutcomePrismaLike;
  try {
    ({ PrismaClient } = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => CmsOutcomePrismaLike;
    });
  } catch (cause) {
    throw new Error(
      "DATABASE_URL is set but the Prisma client is not generated. Run `pnpm --filter @awe/persistence db:generate`.",
      { cause },
    );
  }

  return new PrismaCmsOutcomeStore(new PrismaClient());
}
