import type { Tier } from "./tiers";

/**
 * The payment rail, behind an interface.
 *
 * Entitlement enforcement (tiers, quotas, usage) is deliberately independent of
 * *how* money is collected — it is pure logic and fully tested. Stripe only
 * answers "what tier has this org paid for" and "start a checkout". Keeping it
 * behind this seam means the product runs, and is testable, with no Stripe
 * account; a real Stripe adapter drops in later without touching the guard.
 */
export interface BillingProvider {
  /** The tier an org has an active paid subscription for, or null if none. */
  activeTier(orgId: string): Promise<Tier | null>;
  /** Begin an upgrade; returns a URL to send the user to. */
  createCheckout(orgId: string, tier: Tier): Promise<{ url: string }>;
}

/**
 * No-op provider: everyone is Free, checkout is unavailable.
 *
 * The default when STRIPE_SECRET_KEY is absent, so local and test runs need no
 * payment configuration. A `StripeBillingProvider` implementing this same
 * interface is the deployment-time replacement.
 */
export const manualBillingProvider: BillingProvider = {
  async activeTier() {
    return null;
  },
  async createCheckout() {
    throw new Error("Billing is not configured (set STRIPE_SECRET_KEY to enable checkout).");
  },
};
