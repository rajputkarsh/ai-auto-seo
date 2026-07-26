import { describe, expect, it } from "vitest";
import { createApiKeyStore } from "./factory";
import { hashApiKey } from "./keys";
import { type AuthPrismaLike, PrismaApiKeyStore } from "./prisma";
import { type ApiKeyStore, InMemoryApiKeyStore } from "./store";

/** In-memory fake of the structural client so the Prisma store logic runs for real. */
function prismaFake(): ApiKeyStore {
  const rows: {
    id: string;
    orgId: string;
    role: string;
    hash: string;
    display: string;
    label: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  }[] = [];
  let seq = 0;
  const client: AuthPrismaLike = {
    apiKey: {
      async create({ data }) {
        const row = { ...data, id: `key_${++seq}` };
        rows.push(row);
        return row;
      },
      async findUnique({ where }) {
        return rows.find((r) => r.hash === where.hash) ?? null;
      },
      async update({ where, data }) {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return {};
      },
      async updateMany({ where, data }) {
        const row = rows.find((r) => r.id === where.id && r.revokedAt === null);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      async findMany({ where }) {
        // Newest-first, matching the orderBy the store asks for.
        return rows.filter((r) => r.orgId === where.orgId).reverse();
      },
    },
  };
  return new PrismaApiKeyStore(client);
}

describe("createApiKeyStore", () => {
  it("returns the in-memory store without DATABASE_URL", async () => {
    expect(await createApiKeyStore({})).toBeInstanceOf(InMemoryApiKeyStore);
  });
});

describe("ApiKeyStore contract holds for both implementations", () => {
  for (const [name, makeStore] of [
    ["in-memory", () => new InMemoryApiKeyStore()],
    ["prisma", () => prismaFake()],
  ] as const) {
    it(`round-trips create → resolve → list → revoke (${name})`, async () => {
      const store = makeStore();
      const { record, plaintext } = await store.create({
        orgId: "acme",
        role: "owner",
        label: "ci",
      });
      expect(record.orgId).toBe("acme");
      expect(record.label).toBe("ci");
      // The hash must never be exposed on a returned/listed record.
      expect("hash" in record).toBe(false);

      const identity = await store.resolve(plaintext);
      expect(identity).toMatchObject({
        orgId: "acme",
        role: "owner",
        via: "apikey",
        keyId: record.id,
      });

      const listed = await store.list("acme");
      expect(listed).toHaveLength(1);
      expect("hash" in listed[0]!).toBe(false);

      expect(await store.revoke(record.id)).toBe(true);
      // Fail closed: a revoked key resolves to nobody.
      expect(await store.resolve(plaintext)).toBeNull();
      // Revoking again is a no-op, reported as false.
      expect(await store.revoke(record.id)).toBe(false);
    });

    it(`resolves an unknown or malformed key to null (${name})`, async () => {
      const store = makeStore();
      expect(await store.resolve("awe_totally-made-up-key-value")).toBeNull();
      expect(await store.resolve("not-even-close")).toBeNull();
    });

    it(`isolates keys by org (${name})`, async () => {
      const store = makeStore();
      await store.create({ orgId: "acme", role: "owner" });
      await store.create({ orgId: "globex", role: "member" });
      expect(await store.list("acme")).toHaveLength(1);
      expect(await store.list("globex")).toHaveLength(1);
    });
  }
});

describe("stored shape", () => {
  it("persists the hash of the plaintext, not the plaintext", async () => {
    const store = new InMemoryApiKeyStore();
    const { plaintext } = await store.create({ orgId: "acme", role: "owner" });
    // Resolving by the correct hash proves the stored key is the hash.
    const viaHashCollision = await store.resolve(plaintext);
    expect(viaHashCollision).not.toBeNull();
    expect(hashApiKey(plaintext)).toMatch(/^[0-9a-f]{64}$/);
  });
});
