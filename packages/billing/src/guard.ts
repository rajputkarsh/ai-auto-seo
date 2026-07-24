import type { SubscriptionStore } from "./subscription";
import { resolveEntitlements } from "./subscription";
import type { UsageMeter } from "./usage";

export type DenyReason = "suspended" | "scan_quota_exceeded";

export type QuotaDecision =
  | { allowed: true; maxPagesPerScan: number | null; patches: boolean }
  | { allowed: false; reason: DenyReason; message: string };

/**
 * Decides whether an org may run a scan right now, and with what limits.
 *
 * Enforcement lives in one place so every entry point (HTTP scan, queued job)
 * asks the same question and cannot drift. The guard reads entitlements and
 * usage but never mutates — recording usage is the caller's job, after the work
 * succeeds, so a rejected or failed scan is never billed.
 */
export class QuotaGuard {
  constructor(
    private readonly subscriptions: SubscriptionStore,
    private readonly usage: UsageMeter,
  ) {}

  async check(orgId: string, at: Date = new Date()): Promise<QuotaDecision> {
    const sub = await this.subscriptions.get(orgId);
    if (sub.suspended) {
      return { allowed: false, reason: "suspended", message: "This account is suspended." };
    }

    const entitlements = resolveEntitlements(sub);
    const used = await this.usage.current(orgId, at);

    if (entitlements.maxScansPerMonth !== null && used.scans >= entitlements.maxScansPerMonth) {
      return {
        allowed: false,
        reason: "scan_quota_exceeded",
        message: `Monthly scan limit of ${entitlements.maxScansPerMonth} reached for the ${entitlements.tier} plan.`,
      };
    }

    return {
      allowed: true,
      maxPagesPerScan: entitlements.maxPagesPerScan,
      patches: entitlements.patches,
    };
  }
}
