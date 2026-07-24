import {
  type Entitlements,
  isTier,
  resolveEntitlements,
  type SubscriptionStore,
  type UsageMeter,
} from "@awe/billing";
import type { ScanStore } from "@awe/persistence";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export interface AdminAuditEntry {
  at: string;
  action: string;
  orgId: string;
  detail?: unknown;
}

/** Append-only, in-memory audit trail (Postgres-backed in a deployment). */
export class AdminAuditLog {
  private readonly entries: AdminAuditEntry[] = [];
  record(action: string, orgId: string, detail?: unknown): void {
    this.entries.push({ at: new Date().toISOString(), action, orgId, detail });
  }
  list(limit = 100): AdminAuditEntry[] {
    return this.entries.slice(-limit).reverse();
  }
}

export interface AdminDeps {
  subscriptions: SubscriptionStore;
  usage: UsageMeter;
  scanStore: ScanStore;
  audit: AdminAuditLog;
  /** Required. When absent the whole plugin refuses to mount — fail closed. */
  staffToken?: string;
}

const planBody = z.object({
  tier: z.string().refine(isTier, "unknown tier"),
  suspended: z.boolean().optional(),
});
const overrideBody = z.object({
  maxScansPerMonth: z.coerce.number().int().nonnegative().nullable().optional(),
  maxProperties: z.coerce.number().int().nonnegative().nullable().optional(),
  maxPagesPerScan: z.coerce.number().int().nonnegative().nullable().optional(),
});

/**
 * The cross-tenant admin surface, isolated as a plugin under `/admin/*`.
 *
 * Two isolation guarantees that make this safe to expose:
 *  1. **Fail closed** — with no STAFF_TOKEN configured the plugin does not
 *     register at all, so admin endpoints simply don't exist rather than
 *     defaulting to open.
 *  2. **Every route is behind a staff bearer check**, and every mutation is
 *     written to the audit log with the actor's intent.
 */
export async function registerAdmin(app: FastifyInstance, deps: AdminDeps): Promise<void> {
  const { subscriptions, usage, scanStore, audit, staffToken } = deps;

  if (!staffToken) {
    app.log.warn("STAFF_TOKEN not set — admin API disabled");
    return;
  }

  app.register(
    async (admin) => {
      // Bearer gate on every admin route. Cross-tenant access exists ONLY here.
      admin.addHook("onRequest", async (req, reply) => {
        const header = req.headers.authorization ?? "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (token !== staffToken) {
          reply
            .code(401)
            .send({ error: { code: "unauthorized", message: "Staff token required." } });
        }
      });

      admin.get("/orgs", async () => {
        const subs = await subscriptions.list();
        const rows = await Promise.all(
          subs.map(async (sub) => ({
            orgId: sub.orgId,
            tier: sub.tier,
            suspended: sub.suspended,
            entitlements: resolveEntitlements(sub),
            usage: await usage.current(sub.orgId),
          })),
        );
        return { orgs: rows };
      });

      admin.get<{ Params: { orgId: string } }>("/orgs/:orgId", async (req) => {
        const orgId = req.params.orgId;
        const sub = await subscriptions.get(orgId);
        return {
          orgId,
          tier: sub.tier,
          suspended: sub.suspended,
          entitlements: resolveEntitlements(sub),
          usage: await usage.current(orgId),
          scans: await scanStore.listScans(orgId, 20),
        };
      });

      admin.post<{ Params: { orgId: string } }>("/orgs/:orgId/plan", async (req, reply) => {
        const parsed = planBody.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: { code: "invalid_request", message: "bad plan" } });
        }
        const orgId = req.params.orgId;
        const existing = await subscriptions.get(orgId);
        await subscriptions.set({
          ...existing,
          orgId,
          tier: parsed.data.tier as Entitlements["tier"],
          suspended: parsed.data.suspended ?? existing.suspended,
        });
        audit.record("set_plan", orgId, parsed.data);
        return { ok: true };
      });

      admin.post<{ Params: { orgId: string } }>("/orgs/:orgId/override", async (req, reply) => {
        const parsed = overrideBody.safeParse(req.body);
        if (!parsed.success) {
          return reply
            .code(400)
            .send({ error: { code: "invalid_request", message: "bad override" } });
        }
        const orgId = req.params.orgId;
        const existing = await subscriptions.get(orgId);
        await subscriptions.set({ ...existing, overrides: parsed.data });
        audit.record("set_override", orgId, parsed.data);
        return { ok: true };
      });

      admin.post<{ Params: { orgId: string }; Body: { suspended?: boolean } }>(
        "/orgs/:orgId/suspend",
        async (req) => {
          const orgId = req.params.orgId;
          const suspended = req.body?.suspended ?? true;
          const existing = await subscriptions.get(orgId);
          await subscriptions.set({ ...existing, suspended });
          audit.record(suspended ? "suspend" : "unsuspend", orgId);
          return { ok: true, suspended };
        },
      );

      admin.get("/audit", async () => ({ entries: audit.list() }));
    },
    { prefix: "/admin" },
  );
}
