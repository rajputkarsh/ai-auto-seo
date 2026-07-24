import { InMemoryScanStore } from "./memory";
import { type PrismaLike, PrismaScanStore } from "./prisma";
import type { ScanStore } from "./store";

export interface StoreConfig {
  databaseUrl?: string;
}

/**
 * Pick a scan store from configuration.
 *
 * The choice is intentionally a single boolean — DATABASE_URL present or not —
 * so switching between local (in-memory) and deployed (Postgres) is a config
 * change, not a code change. Prisma is imported *lazily* so that consumers and
 * tests that never touch a database don't need a generated client on disk.
 */
export async function createScanStore(config: StoreConfig): Promise<ScanStore> {
  if (!config.databaseUrl) return new InMemoryScanStore();

  let PrismaClient: new () => PrismaLike;
  try {
    ({ PrismaClient } = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => PrismaLike;
    });
  } catch (cause) {
    throw new Error(
      "DATABASE_URL is set but the Prisma client is not generated. Run `pnpm --filter @awe/persistence db:generate`.",
      { cause },
    );
  }

  return new PrismaScanStore(new PrismaClient());
}
