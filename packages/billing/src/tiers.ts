export type Tier = "free" | "pro" | "team" | "enterprise";

/**
 * What a tier is allowed to do.
 *
 * `null` means unlimited. Enforcement reads these numbers, so the catalog is the
 * single source of truth for "what does each plan get" — changing a limit is a
 * one-line edit here, not a hunt through request handlers.
 */
export interface Entitlements {
  tier: Tier;
  /** Distinct monitored properties an org may hold. */
  maxProperties: number | null;
  /** Scans allowed per calendar month across all properties. */
  maxScansPerMonth: number | null;
  /** Whether generated patches (Policy 2) are offered. */
  patches: boolean;
  /** Whether scheduled/continuous monitoring is available. */
  monitoring: boolean;
  /** Pages a single scan may crawl. */
  maxPagesPerScan: number | null;
}

export const TIERS: Record<Tier, Entitlements> = {
  free: {
    tier: "free",
    maxProperties: 1,
    maxScansPerMonth: 30,
    patches: true,
    monitoring: false,
    maxPagesPerScan: 25,
  },
  pro: {
    tier: "pro",
    maxProperties: 5,
    maxScansPerMonth: 1_000,
    patches: true,
    monitoring: true,
    maxPagesPerScan: 200,
  },
  team: {
    tier: "team",
    maxProperties: 25,
    maxScansPerMonth: 10_000,
    patches: true,
    monitoring: true,
    maxPagesPerScan: 500,
  },
  enterprise: {
    tier: "enterprise",
    maxProperties: null,
    maxScansPerMonth: null,
    patches: true,
    monitoring: true,
    maxPagesPerScan: null,
  },
};

export function isTier(value: string): value is Tier {
  return value in TIERS;
}

/**
 * Resolve an org's effective entitlements: the tier's defaults, with any
 * per-org overrides applied on top (a superadmin raising one org's scan cap
 * without moving it to a new plan).
 */
export function entitlementsFor(tier: Tier, overrides?: Partial<Entitlements>): Entitlements {
  return { ...TIERS[tier], ...overrides, tier };
}
