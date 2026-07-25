export type AutonomyMode = "deny" | "auto_apply" | "auto_apply_deploy";

/** A freeze window during which no autonomy runs (e.g. a launch/holiday freeze). */
export interface BlackoutWindow {
  from: string; // ISO instant
  to: string; // ISO instant
}

export interface AutonomyRule {
  issueType: string;
  mode: AutonomyMode;
  /** Minimum confidence before this issue may be applied autonomously. */
  minConfidence: number;
  /** Cap on autonomous changes per rolling day for this issue. */
  maxChangesPerDay: number;
  blackoutWindows?: BlackoutWindow[];
}

export interface AutonomyPolicy {
  accountId: string;
  rules: AutonomyRule[];
  /** Halts ALL autonomy for the account instantly, regardless of rules. */
  globalKillSwitch: boolean;
}

export interface EvaluationContext {
  issueType: string;
  confidence: number;
  /** Autonomous applies already made today for this issue. */
  appliedToday: number;
  now: Date;
}

export type PolicyDecision =
  | { mode: "auto_apply" | "auto_apply_deploy" }
  | { mode: "deny"; reason: DenyReason };

export type DenyReason =
  | "kill_switch"
  | "no_rule"
  | "rule_denies"
  | "below_confidence"
  | "budget_exhausted"
  | "blackout_window";

/**
 * Decide whether one fix may be applied autonomously.
 *
 * **Default-deny and fail-closed** are the whole point: autonomy is granted only
 * when an explicit rule permits it AND every guard passes. Any gap — no rule,
 * the kill switch, low confidence, a spent budget, a freeze window — denies and
 * routes back to human approval. Each denial carries a reason so the audit log
 * records *why* autonomy was withheld.
 */
export function evaluatePolicy(policy: AutonomyPolicy, ctx: EvaluationContext): PolicyDecision {
  if (policy.globalKillSwitch) return { mode: "deny", reason: "kill_switch" };

  const rule = policy.rules.find((r) => r.issueType === ctx.issueType);
  if (!rule) return { mode: "deny", reason: "no_rule" }; // default-deny
  if (rule.mode === "deny") return { mode: "deny", reason: "rule_denies" };
  if (ctx.confidence < rule.minConfidence) return { mode: "deny", reason: "below_confidence" };
  if (ctx.appliedToday >= rule.maxChangesPerDay)
    return { mode: "deny", reason: "budget_exhausted" };
  if (inBlackout(rule.blackoutWindows, ctx.now)) return { mode: "deny", reason: "blackout_window" };

  return { mode: rule.mode };
}

function inBlackout(windows: BlackoutWindow[] | undefined, now: Date): boolean {
  if (!windows) return false;
  const t = now.getTime();
  return windows.some((w) => {
    const from = Date.parse(w.from);
    const to = Date.parse(w.to);
    // A window with unparseable bounds fails closed — treat as active.
    if (Number.isNaN(from) || Number.isNaN(to)) return true;
    return t >= from && t <= to;
  });
}

/**
 * Demote an issue's autonomy to `deny` — used after an auto-rollback, so a fix
 * that misbehaved once cannot keep re-applying. Returns a new policy; the caller
 * persists it.
 */
export function demoteRule(policy: AutonomyPolicy, issueType: string): AutonomyPolicy {
  return {
    ...policy,
    rules: policy.rules.map((r) => (r.issueType === issueType ? { ...r, mode: "deny" } : r)),
  };
}

/** A safe default: autonomy fully off. New accounts start here (Level 1). */
export function denyAllPolicy(accountId: string): AutonomyPolicy {
  return { accountId, rules: [], globalKillSwitch: false };
}
