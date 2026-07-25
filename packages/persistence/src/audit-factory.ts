import {
  type AuditPrismaLike,
  type AuditStore,
  InMemoryAuditStore,
  PrismaAuditStore,
} from "./audit";
import type { StoreConfig } from "./factory";

/**
 * Pick the audit store from configuration — DATABASE_URL present → Postgres,
 * absent → in-memory. Same lazy-import discipline as the scan store.
 */
export async function createAuditStore(config: StoreConfig): Promise<AuditStore> {
  if (!config.databaseUrl) return new InMemoryAuditStore();

  let PrismaClient: new () => AuditPrismaLike;
  try {
    ({ PrismaClient } = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => AuditPrismaLike;
    });
  } catch (cause) {
    throw new Error(
      "DATABASE_URL is set but the Prisma client is not generated. Run `pnpm --filter @awe/persistence db:generate`.",
      { cause },
    );
  }

  return new PrismaAuditStore(new PrismaClient());
}
