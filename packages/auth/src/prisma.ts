import { generateApiKey, hashApiKey, looksLikeApiKey } from "./keys";
import type { ApiKeyRecord, ApiKeyStore, CreateKeyInput, PublicApiKey } from "./store";
import type { Identity, Role } from "./types";

/**
 * The subset of the generated Prisma client the key store uses.
 *
 * Structural (not imported from `@prisma/client`) so the package typechecks and
 * tests with no generated client; the real client is only needed at deploy time.
 */
export interface AuthPrismaLike {
  apiKey: {
    create(args: { data: Omit<ApiKeyRow, "id"> }): Promise<ApiKeyRow>;
    findUnique(args: { where: { hash: string } }): Promise<ApiKeyRow | null>;
    update(args: { where: { id: string }; data: { lastUsedAt: Date } }): Promise<unknown>;
    updateMany(args: {
      where: { id: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
    findMany(args: {
      where: { orgId: string };
      orderBy: { createdAt: "desc" };
    }): Promise<ApiKeyRow[]>;
  };
}

interface ApiKeyRow {
  id: string;
  orgId: string;
  role: string;
  hash: string;
  display: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

function rowToPublic(row: ApiKeyRow): PublicApiKey {
  const record: ApiKeyRecord = {
    id: row.id,
    orgId: row.orgId,
    role: row.role as Role,
    hash: row.hash,
    display: row.display,
    createdAt: row.createdAt,
    ...(row.label ? { label: row.label } : {}),
    ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
  };
  const { hash: _hash, ...pub } = record;
  return pub;
}

/**
 * Postgres-backed key store. Mirrors `InMemoryApiKeyStore`: only the hash is
 * persisted, `resolve` fails closed on an unknown or revoked key, and `list`
 * never returns the hash.
 */
export class PrismaApiKeyStore implements ApiKeyStore {
  constructor(private readonly prisma: AuthPrismaLike) {}

  async create(input: CreateKeyInput): Promise<{ record: PublicApiKey; plaintext: string }> {
    const key = generateApiKey();
    const row = await this.prisma.apiKey.create({
      // id is DB-defaulted (cuid).
      data: {
        orgId: input.orgId,
        role: input.role,
        hash: key.hash,
        display: key.display,
        label: input.label ?? null,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      },
    });
    return { record: rowToPublic(row), plaintext: key.plaintext };
  }

  async resolve(plaintext: string): Promise<Identity | null> {
    if (!looksLikeApiKey(plaintext)) return null;
    const row = await this.prisma.apiKey.findUnique({ where: { hash: hashApiKey(plaintext) } });
    if (!row || row.revokedAt) return null;
    // Best-effort last-used stamp; never block the request on it.
    await this.prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return { orgId: row.orgId, role: row.role as Role, keyId: row.id, via: "apikey" };
  }

  async list(orgId: string): Promise<PublicApiKey[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(rowToPublic);
  }

  async revoke(keyId: string): Promise<boolean> {
    // Guard on the not-yet-revoked state so an unknown OR already-revoked key
    // reports false, matching the in-memory store (count === 1 only on a flip).
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id: keyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }
}
