import { describe, expect, it } from "vitest";
import {
  type AuditPrismaLike,
  type AuditStore,
  InMemoryAuditStore,
  PrismaAuditStore,
} from "./audit";
import { createAuditStore } from "./audit-factory";

/** In-memory fake of the structural client so the Prisma store logic runs for real. */
function fakeStore(): AuditStore {
  const rows: { at: Date; action: string; orgId: string; detail: unknown }[] = [];
  let clock = 0;
  const client: AuditPrismaLike = {
    auditEvent: {
      async create({ data }) {
        // Monotonic timestamps so newest-first ordering is deterministic.
        rows.push({
          at: new Date(++clock),
          action: data.action,
          orgId: data.orgId,
          detail: data.detail,
        });
        return {};
      },
      async findMany({ take }) {
        return [...rows].reverse().slice(0, take);
      },
    },
  };
  return new PrismaAuditStore(client);
}

describe("createAuditStore", () => {
  it("returns the in-memory store without DATABASE_URL", async () => {
    expect(await createAuditStore({})).toBeInstanceOf(InMemoryAuditStore);
  });
});

describe("audit trail is append-only and newest-first across implementations", () => {
  for (const [name, store] of [
    ["in-memory", new InMemoryAuditStore()],
    ["prisma", fakeStore()],
  ] as const) {
    it(`records and lists newest-first (${name})`, async () => {
      await store.record("set_plan", "acme", { tier: "pro" });
      await store.record("suspend", "acme");

      const events = await store.list();
      expect(events).toHaveLength(2);
      expect(events[0]?.action).toBe("suspend");
      expect(events[1]?.action).toBe("set_plan");
      expect(events[1]?.detail).toEqual({ tier: "pro" });
      // An action with no detail omits the field rather than carrying null.
      expect(events[0] && "detail" in events[0]).toBe(false);

      expect(await store.list(1)).toHaveLength(1);
    });
  }
});
