import type { ApiKeyStore } from "./store";
import type { AuthMode, Identity, Role } from "./types";

/** Extract the token from an `Authorization: Bearer <token>` header, if present. */
export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

export interface ResolveInput {
  mode: AuthMode;
  store: ApiKeyStore;
  /** The Authorization header value. */
  authorization?: string | string[];
  /** The `x-awe-org` header — the dev-mode identity source. */
  devOrgHeader?: string | string[];
}

/**
 * Resolve a request to an `Identity`, or null when it is unauthenticated.
 *
 * A valid API key always wins, in either mode — so a developer can exercise the
 * real credential path locally. The difference is the fallback:
 *  - **apikey** (production): no valid key → null. The `x-awe-org` header is
 *    ignored entirely, closing the stand-in that let anyone claim any tenant.
 *  - **dev** (local, zero-config): no key → trust `x-awe-org` (defaulting to
 *    "default") as an `owner`, so the product runs with no credentials to set up.
 *    This is a deliberate, loudly-logged convenience that must never run in prod.
 */
export async function resolveIdentity(input: ResolveInput): Promise<Identity | null> {
  const token = bearerToken(input.authorization);
  if (token) {
    const identity = await input.store.resolve(token);
    if (identity) return identity;
    // A bearer was presented but is not a valid key: reject in BOTH modes rather
    // than falling through to the dev header. A wrong key is an explicit auth
    // failure, not "anonymous" — treating it as the latter would mask the error
    // and let a stale/typo'd credential silently act as the header's tenant.
    return null;
  }

  if (input.mode === "dev") {
    const header = Array.isArray(input.devOrgHeader) ? input.devOrgHeader[0] : input.devOrgHeader;
    const orgId = header?.trim() || "default";
    const role: Role = "owner";
    return { orgId, role, via: "dev" };
  }

  return null;
}
