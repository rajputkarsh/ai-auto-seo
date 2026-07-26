import { type AuthPrismaLike, PrismaApiKeyStore } from "./prisma";
import { type ApiKeyStore, InMemoryApiKeyStore } from "./store";

export interface AuthStoreConfig {
  databaseUrl?: string;
}

/**
 * Pick the API-key store from configuration — DATABASE_URL present → Postgres,
 * absent → in-memory. Prisma is imported lazily so callers without a database
 * need no generated client. Same discipline as every other store factory.
 */
export async function createApiKeyStore(config: AuthStoreConfig): Promise<ApiKeyStore> {
  if (!config.databaseUrl) return new InMemoryApiKeyStore();

  let PrismaClient: new () => AuthPrismaLike;
  try {
    ({ PrismaClient } = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => AuthPrismaLike;
    });
  } catch (cause) {
    throw new Error(
      "DATABASE_URL is set but the Prisma client is not generated. Run `pnpm --filter @awe/persistence db:generate`.",
      { cause },
    );
  }

  return new PrismaApiKeyStore(new PrismaClient());
}
