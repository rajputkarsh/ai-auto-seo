import { type ApiKeyStore, type AuthMode, type Identity, resolveIdentity } from "@awe/auth";
import type { FastifyInstance, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth hook on every non-public route; absent only on public ones. */
    identity?: Identity;
  }
}

/** Routes reachable without authentication. `/admin/*` runs its own STAFF_TOKEN gate. */
function isPublic(pathname: string): boolean {
  return pathname === "/healthz" || pathname === "/metrics" || pathname.startsWith("/admin");
}

export interface AuthDeps {
  store: ApiKeyStore;
  mode: AuthMode;
}

/**
 * Authentication for the main API.
 *
 * A single `onRequest` hook resolves every non-public request to an `Identity`
 * (from a Bearer API key, or the `x-awe-org` dev fallback) and attaches it to the
 * request. When resolution fails it short-circuits with 401 — so downstream
 * handlers can treat `req.identity` as always present. This replaces the old
 * "trust the `x-awe-org` header" stand-in: in `apikey` mode that header no longer
 * grants anything, only a verified key does.
 */
export function registerAuth(app: FastifyInstance, deps: AuthDeps): void {
  app.addHook("onRequest", async (req, reply) => {
    const pathname = req.url.split("?")[0] ?? req.url;
    if (isPublic(pathname)) return;

    const identity = await resolveIdentity({
      mode: deps.mode,
      store: deps.store,
      authorization: req.headers.authorization,
      devOrgHeader: req.headers["x-awe-org"],
    });
    if (!identity) {
      return reply.code(401).send({
        error: {
          code: "unauthorized",
          message: "A valid API key is required. Send it as `Authorization: Bearer awe_…`.",
        },
      });
    }
    req.identity = identity;
  });

  // Echoes the caller's resolved identity — the dashboard uses it to validate a
  // pasted key (a 401 here means the key is wrong), and it's a handy self-check.
  app.get("/auth/whoami", async (req) => identityOf(req));
}

/**
 * The org a request belongs to. Safe on every non-public route because the auth
 * hook guarantees `req.identity` there; the `"default"` fallback only applies if
 * called from a public route, which never happens in practice.
 */
export function orgOf(req: FastifyRequest): string {
  return req.identity?.orgId ?? "default";
}

/** The full resolved identity, shaped for a response. */
export function identityOf(req: FastifyRequest): {
  orgId: string;
  role: string;
  via: string;
  keyId: string | null;
} {
  const id = req.identity;
  return {
    orgId: id?.orgId ?? "default",
    role: id?.role ?? "owner",
    via: id?.via ?? "dev",
    keyId: id?.keyId ?? null,
  };
}
