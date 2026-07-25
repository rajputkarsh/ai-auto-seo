import { type AutonomyPolicy, evaluatePolicy, type PolicyDecision } from "@awe/policy";
import {
  type AutonomousAction,
  type ExecutionOutcome,
  type ExecutorHooks,
  runAutonomousApply,
} from "./executor";

export interface MaybeApplyInput {
  policy: AutonomyPolicy;
  action: AutonomousAction;
  confidence: number;
  appliedToday: number;
  now?: Date;
}

export type MaybeApplyOutcome =
  | { status: "deferred_to_human"; reason: string }
  | (ExecutionOutcome & { mode: "auto_apply" | "auto_apply_deploy" });

/**
 * The single autonomous-apply entry point: evaluate policy, then execute only if
 * permitted. This is the seam Level-2/3 autonomy plugs into — everything before
 * it (detection, reasoning, P3/P4 validation) is unchanged, and everything the
 * policy denies falls straight back to the human-approval path.
 */
export async function maybeAutonomouslyApply(
  input: MaybeApplyInput,
  hooks: ExecutorHooks = {},
): Promise<MaybeApplyOutcome> {
  const decision: PolicyDecision = evaluatePolicy(input.policy, {
    issueType: input.action.issueType,
    confidence: input.confidence,
    appliedToday: input.appliedToday,
    now: input.now ?? hooks.now?.() ?? new Date(),
  });

  if (decision.mode === "deny") {
    hooks.audit?.({
      at: (input.now ?? new Date()).toISOString(),
      step: "monitored",
      issueType: input.action.issueType,
      detail: `policy deny: ${decision.reason}`,
    });
    return { status: "deferred_to_human", reason: decision.reason };
  }

  const outcome = await runAutonomousApply(input.action, hooks);
  return { ...outcome, mode: decision.mode };
}
