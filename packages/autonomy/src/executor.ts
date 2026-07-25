export interface Inverse {
  /** Human-readable description of what the revert does. */
  label: string;
  revert: () => Promise<void>;
}

export interface MonitorResult {
  healthy: boolean;
  detail?: string;
}

export interface AutonomyAuditEvent {
  at: string;
  step:
    | "inverse_captured"
    | "applied"
    | "monitored"
    | "rolled_back"
    | "rollback_failed"
    | "completed_ok"
    | "apply_failed";
  issueType: string;
  detail?: string;
}

/**
 * An action to perform autonomously. The ordering of these methods is the whole
 * safety story:
 *
 *  - `captureInverse` runs FIRST and returns a tested revert plan. Nothing is
 *    changed until we already hold the means to undo it — reversible by
 *    construction, not reversible by hope.
 *  - `apply` performs the (already-validated) change.
 *  - `monitor` observes the result over the caller's window.
 */
export interface AutonomousAction {
  issueType: string;
  captureInverse: () => Promise<Inverse>;
  apply: () => Promise<void>;
  monitor: () => Promise<MonitorResult>;
}

export interface ExecutorHooks {
  audit?: (event: AutonomyAuditEvent) => void;
  /** Called after a rollback so the policy can demote this issue to deny. */
  demote?: (issueType: string, reason: string) => Promise<void> | void;
  alert?: (message: string) => Promise<void> | void;
  now?: () => Date;
}

export type ExecutionOutcome =
  | { status: "applied_ok" }
  | { status: "rolled_back"; reason: string }
  | { status: "rollback_failed"; reason: string };

/**
 * Run one autonomous apply with post-apply monitoring and auto-rollback.
 *
 * The contract, in order:
 *   1. capture the inverse (revert plan) BEFORE any change;
 *   2. apply — if it throws, roll back immediately;
 *   3. monitor — if unhealthy, roll back;
 *   4. on any rollback: revert, demote the issue to deny, alert.
 *
 * `rollback_failed` is the one state a human must see immediately: the change is
 * live and the automatic undo did not work. It is alerted, never swallowed.
 */
export async function runAutonomousApply(
  action: AutonomousAction,
  hooks: ExecutorHooks = {},
): Promise<ExecutionOutcome> {
  const now = hooks.now ?? (() => new Date());
  const audit = (step: AutonomyAuditEvent["step"], detail?: string) =>
    hooks.audit?.({
      at: now().toISOString(),
      step,
      issueType: action.issueType,
      ...(detail ? { detail } : {}),
    });

  // 1. Reversible by construction: hold the undo before touching anything.
  const inverse = await action.captureInverse();
  audit("inverse_captured", inverse.label);

  const rollback = async (reason: string): Promise<ExecutionOutcome> => {
    try {
      await inverse.revert();
      audit("rolled_back", reason);
      await hooks.demote?.(action.issueType, reason);
      await hooks.alert?.(`Auto-rolled-back ${action.issueType}: ${reason}`);
      return { status: "rolled_back", reason };
    } catch (revertErr) {
      const detail = describe(revertErr);
      audit("rollback_failed", detail);
      // A live change we could not undo — the loudest possible signal.
      await hooks.alert?.(
        `ROLLBACK FAILED for ${action.issueType} (${reason}): ${detail}. Manual intervention required.`,
      );
      return { status: "rollback_failed", reason: `${reason}; revert failed: ${detail}` };
    }
  };

  // 2. Apply — a throw means the change may be partial; undo it.
  try {
    await action.apply();
    audit("applied");
  } catch (applyErr) {
    audit("apply_failed", describe(applyErr));
    return rollback(`apply threw: ${describe(applyErr)}`);
  }

  // 3. Monitor the result.
  let result: MonitorResult;
  try {
    result = await action.monitor();
  } catch (monitorErr) {
    // If we cannot confirm health, we assume the worst and roll back.
    return rollback(`monitor threw: ${describe(monitorErr)}`);
  }
  audit("monitored", result.healthy ? "healthy" : (result.detail ?? "unhealthy"));

  if (!result.healthy) return rollback(result.detail ?? "post-apply monitor reported unhealthy");

  audit("completed_ok");
  return { status: "applied_ok" };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
