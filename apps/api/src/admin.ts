import type { ApiKeyStore, Role } from "@awe/auth";
import {
  type Entitlements,
  isTier,
  resolveEntitlements,
  type SubscriptionStore,
  type UsageMeter,
} from "@awe/billing";
import type { AuditStore, ScanStore } from "@awe/persistence";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export interface AdminDeps {
  subscriptions: SubscriptionStore;
  usage: UsageMeter;
  scanStore: ScanStore;
  audit: AuditStore;
  apiKeys: ApiKeyStore;
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
const keyBody = z.object({
  role: z.enum(["owner", "member"]).default("member"),
  label: z.string().min(1).max(120).optional(),
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
  const { subscriptions, usage, scanStore, audit, apiKeys, staffToken } = deps;

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
        await audit.record("set_plan", orgId, parsed.data);
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
        await audit.record("set_override", orgId, parsed.data);
        return { ok: true };
      });

      admin.post<{ Params: { orgId: string }; Body: { suspended?: boolean } }>(
        "/orgs/:orgId/suspend",
        async (req) => {
          const orgId = req.params.orgId;
          const suspended = req.body?.suspended ?? true;
          const existing = await subscriptions.get(orgId);
          await subscriptions.set({ ...existing, suspended });
          await audit.record(suspended ? "suspend" : "unsuspend", orgId);
          return { ok: true, suspended };
        },
      );

      // ── API-key management ──────────────────────────────────────────────
      // Superadmin mints keys for an org; the plaintext is returned exactly once
      // (never stored, never listable) so it must be copied at creation time.
      admin.post<{ Params: { orgId: string } }>("/orgs/:orgId/keys", async (req, reply) => {
        const parsed = keyBody.safeParse(req.body ?? {});
        if (!parsed.success) {
          return reply
            .code(400)
            .send({ error: { code: "invalid_request", message: "bad key request" } });
        }
        const orgId = req.params.orgId;
        const { record, plaintext } = await apiKeys.create({
          orgId,
          role: parsed.data.role as Role,
          ...(parsed.data.label ? { label: parsed.data.label } : {}),
        });
        await audit.record("create_key", orgId, { keyId: record.id, role: record.role });
        // `key` is shown once; everything else is safe to display again later.
        return reply.code(201).send({ key: plaintext, record });
      });

      admin.get<{ Params: { orgId: string } }>("/orgs/:orgId/keys", async (req) => ({
        keys: await apiKeys.list(req.params.orgId),
      }));

      admin.delete<{ Params: { keyId: string } }>("/keys/:keyId", async (req, reply) => {
        const revoked = await apiKeys.revoke(req.params.keyId);
        if (!revoked) {
          return reply
            .code(404)
            .send({ error: { code: "not_found", message: "no active key with that id" } });
        }
        await audit.record("revoke_key", "-", { keyId: req.params.keyId });
        return { revoked: true };
      });

      admin.get("/audit", async () => ({ entries: await audit.list() }));
    },
    { prefix: "/admin" },
  );
}
