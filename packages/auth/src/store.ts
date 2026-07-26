import { generateApiKey, hashApiKey, looksLikeApiKey } from "./keys";
import type { Identity, Role } from "./types";

export interface ApiKeyRecord {
  id: string;
  orgId: string;
  role: Role;
  /** SHA-256 of the plaintext. Never leaves the store. */
  hash: string;
  display: string;
  label?: string;
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}

/** An `ApiKeyRecord` safe to return over the wire — the hash is stripped. */
export type PublicApiKey = Omit<ApiKeyRecord, "hash">;

export interface CreateKeyInput {
  orgId: string;
  role: Role;
  label?: string;
}

/**
 * Stores API keys and resolves a presented key to an `Identity`.
 *
 * The contract every implementation upholds:
 *  - only the hash is persisted; `create` returns the plaintext once and it is
 *    unrecoverable thereafter;
 *  - `resolve` returns null for an unknown OR revoked key (fail closed);
 *  - `list` never exposes the hash.
 */
export interface ApiKeyStore {
  create(input: CreateKeyInput): Promise<{ record: PublicApiKey; plaintext: string }>;
  resolve(plaintext: string): Promise<Identity | null>;
  list(orgId: string): Promise<PublicApiKey[]>;
  revoke(keyId: string): Promise<boolean>;
}

function strip(record: ApiKeyRecord): PublicApiKey {
  const { hash: _hash, ...rest } = record;
  return rest;
}

/**
 * In-memory key store — the default, so auth works before anyone provisions
 * Postgres. Indexed by hash (for O(1) resolve) and by id (for revoke).
 */
export class InMemoryApiKeyStore implements ApiKeyStore {
  private readonly byHash = new Map<string, ApiKeyRecord>();
  private readonly byId = new Map<string, ApiKeyRecord>();
  private sequence = 0;

  async create(input: CreateKeyInput): Promise<{ record: PublicApiKey; plaintext: string }> {
    const key = generateApiKey();
    const record: ApiKeyRecord = {
      id: `key_${++this.sequence}`,
      orgId: input.orgId,
      role: input.role,
      hash: key.hash,
      display: key.display,
      createdAt: new Date(),
      ...(input.label ? { label: input.label } : {}),
    };
    this.byHash.set(record.hash, record);
    this.byId.set(record.id, record);
    return { record: strip(record), plaintext: key.plaintext };
  }

  async resolve(plaintext: string): Promise<Identity | null> {
    if (!looksLikeApiKey(plaintext)) return null;
    const record = this.byHash.get(hashApiKey(plaintext));
    if (!record || record.revokedAt) return null;
    record.lastUsedAt = new Date();
    return { orgId: record.orgId, role: record.role, keyId: record.id, via: "apikey" };
  }

  async list(orgId: string): Promise<PublicApiKey[]> {
    return [...this.byId.values()].filter((r) => r.orgId === orgId).map(strip);
  }

  async revoke(keyId: string): Promise<boolean> {
    const record = this.byId.get(keyId);
    if (!record || record.revokedAt) return false;
    record.revokedAt = new Date();
    return true;
  }
}
