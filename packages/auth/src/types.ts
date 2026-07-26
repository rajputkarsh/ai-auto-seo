/**
 * Who a request belongs to.
 *
 * Every authenticated request resolves to exactly one `Identity`. `orgId` is the
 * tenant everything downstream is keyed by (billing, quotas, scan history,
 * remediation connections). `role` is the coarse permission tier — the dashboard
 * is role-aware (a developer vs. a non-technical owner), and it gates who may
 * mint or revoke credentials.
 *
 * `via` records HOW the caller proved identity, so logs and the dashboard can
 * distinguish a real API key from the local dev fallback.
 */
export type Role = "owner" | "member";

export interface Identity {
  orgId: string;
  role: Role;
  /** The API key that authenticated this request, if any (absent in dev mode). */
  keyId?: string;
  via: "apikey" | "dev";
}

/** How the API decides identity. `apikey` is the real, enforced mode. */
export type AuthMode = "dev" | "apikey";
