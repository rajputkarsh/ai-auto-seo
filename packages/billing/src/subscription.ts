import { type Entitlements, entitlementsFor, type Tier } from "./tiers";

export interface Subscription {
  orgId: string;
  tier: Tier;
  /** Per-org entitlement overrides (a superadmin comp or a negotiated limit). */
  overrides?: Partial<Entitlements>;
  /** Suspended orgs are blocked from scanning regardless of tier. */
  suspended: boolean;
}

export interface SubscriptionStore {
  get(orgId: string): Promise<Subscription>;
  set(sub: Subscription): Promise<void>;
  list(): Promise<Subscription[]>;
}

/**
 * In-memory subscriptions.
 *
 * An unknown org is treated as Free rather than an error, so the product works
 * for a brand-new caller with no explicit signup — the free tier IS the default
 * state, not a row someone has to create first.
 */
export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly subs = new Map<string, Subscription>();

  async get(orgId: string): Promise<Subscription> {
    return this.subs.get(orgId) ?? { orgId, tier: "free", suspended: false };
  }

  async set(sub: Subscription): Promise<void> {
    this.subs.set(sub.orgId, sub);
  }

  async list(): Promise<Subscription[]> {
    return [...this.subs.values()];
  }
}

export function resolveEntitlements(sub: Subscription): Entitlements {
  return entitlementsFor(sub.tier, sub.overrides);
}
