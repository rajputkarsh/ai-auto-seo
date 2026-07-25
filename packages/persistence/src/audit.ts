export interface AuditEvent {
  at: string;
  action: string;
  orgId: string;
  detail?: unknown;
}

/**
 * Append-only admin audit trail: every cross-tenant mutation records the actor's
 * intent. Reads are newest-first. The interface is async because the deployed
 * implementation writes to Postgres; the in-memory default keeps the same shape
 * so admin routes don't change between local and deployed.
 */
export interface AuditStore {
  record(action: string, orgId: string, detail?: unknown): Promise<void>;
  list(limit?: number): Promise<AuditEvent[]>;
}

export class InMemoryAuditStore implements AuditStore {
  private readonly events: AuditEvent[] = [];

  async record(action: string, orgId: string, detail?: unknown): Promise<void> {
    // Omit `detail` when absent so the stored shape matches the Postgres store,
    // which persists null and drops it on read.
    this.events.push({
      at: new Date().toISOString(),
      action,
      orgId,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    return this.events.slice(-limit).reverse();
  }
}

/** The subset of the generated Prisma client the audit store uses (structural). */
export interface AuditPrismaLike {
  auditEvent: {
    create(args: { data: { action: string; orgId: string; detail: unknown } }): Promise<unknown>;
    findMany(args: {
      orderBy: { at: "desc" };
      take: number;
    }): Promise<{ at: Date; action: string; orgId: string; detail: unknown }[]>;
  };
}

/** Postgres-backed audit trail. Mirrors `InMemoryAuditStore`: append-only, newest-first. */
export class PrismaAuditStore implements AuditStore {
  constructor(private readonly prisma: AuditPrismaLike) {}

  async record(action: string, orgId: string, detail?: unknown): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { action, orgId, detail: detail ?? null },
    });
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    const rows = await this.prisma.auditEvent.findMany({ orderBy: { at: "desc" }, take: limit });
    return rows.map((r) => ({
      at: r.at.toISOString(),
      action: r.action,
      orgId: r.orgId,
      ...(r.detail == null ? {} : { detail: r.detail }),
    }));
  }
}
