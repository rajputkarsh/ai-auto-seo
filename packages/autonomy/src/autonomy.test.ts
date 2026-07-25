import type { AutonomyPolicy } from "@awe/policy";
import { describe, expect, it } from "vitest";
import { maybeAutonomouslyApply } from "./apply";
import { type AutonomousAction, type AutonomyAuditEvent, runAutonomousApply } from "./executor";

/** A recording action whose behaviour is configured per test. */
function buildAction(opts: {
  applyThrows?: boolean;
  monitorHealthy?: boolean;
  monitorThrows?: boolean;
  revertThrows?: boolean;
}): { action: AutonomousAction; log: string[] } {
  const log: string[] = [];
  const action: AutonomousAction = {
    issueType: "missing_canonical",
    captureInverse: async () => {
      log.push("capture");
      return {
        label: "restore canonical",
        revert: async () => {
          log.push("revert");
          if (opts.revertThrows) throw new Error("revert boom");
        },
      };
    },
    apply: async () => {
      log.push("apply");
      if (opts.applyThrows) throw new Error("apply boom");
    },
    monitor: async () => {
      log.push("monitor");
      if (opts.monitorThrows) throw new Error("monitor boom");
      return {
        healthy: opts.monitorHealthy ?? true,
        detail: opts.monitorHealthy ? "ok" : "surface regressed",
      };
    },
  };
  return { action, log };
}

describe("runAutonomousApply — happy path", () => {
  it("captures the inverse BEFORE applying, then completes", async () => {
    const { action, log } = buildAction({ monitorHealthy: true });
    const steps: string[] = [];
    const outcome = await runAutonomousApply(action, { audit: (e) => steps.push(e.step) });

    expect(outcome).toEqual({ status: "applied_ok" });
    // The ordering IS the safety guarantee: capture must precede apply.
    expect(log).toEqual(["capture", "apply", "monitor"]);
    expect(steps).toEqual(["inverse_captured", "applied", "monitored", "completed_ok"]);
  });
});

describe("runAutonomousApply — rollback paths", () => {
  it("rolls back and demotes when the monitor reports unhealthy", async () => {
    const { action, log } = buildAction({ monitorHealthy: false });
    const demoted: string[] = [];
    const alerts: string[] = [];
    const outcome = await runAutonomousApply(action, {
      demote: (issue) => {
        demoted.push(issue);
      },
      alert: (m) => {
        alerts.push(m);
      },
    });

    expect(outcome).toEqual({ status: "rolled_back", reason: "surface regressed" });
    expect(log).toEqual(["capture", "apply", "monitor", "revert"]);
    expect(demoted).toEqual(["missing_canonical"]); // the misbehaving issue is demoted to deny
    expect(alerts[0]).toContain("Auto-rolled-back");
  });

  it("rolls back when apply itself throws (change may be partial)", async () => {
    const { action, log } = buildAction({ applyThrows: true });
    const outcome = await runAutonomousApply(action);
    expect(outcome.status).toBe("rolled_back");
    if (outcome.status === "rolled_back") expect(outcome.reason).toContain("apply threw");
    // Monitor never runs; the revert does.
    expect(log).toEqual(["capture", "apply", "revert"]);
  });

  it("rolls back when the monitor throws (can't confirm health → assume worst)", async () => {
    const { action } = buildAction({ monitorThrows: true });
    const outcome = await runAutonomousApply(action);
    expect(outcome.status).toBe("rolled_back");
    if (outcome.status === "rolled_back") expect(outcome.reason).toContain("monitor threw");
  });

  it("surfaces rollback_failed LOUDLY when the revert itself fails", async () => {
    const { action } = buildAction({ monitorHealthy: false, revertThrows: true });
    const alerts: string[] = [];
    const steps: string[] = [];
    const outcome = await runAutonomousApply(action, {
      alert: (m) => {
        alerts.push(m);
      },
      audit: (e: AutonomyAuditEvent) => steps.push(e.step),
    });

    expect(outcome.status).toBe("rollback_failed");
    expect(steps).toContain("rollback_failed");
    // A live, un-revertible change must page a human.
    expect(
      alerts.some((a) => a.includes("ROLLBACK FAILED") && a.includes("Manual intervention")),
    ).toBe(true);
  });
});

const allowPolicy: AutonomyPolicy = {
  accountId: "acme",
  globalKillSwitch: false,
  rules: [
    {
      issueType: "missing_canonical",
      mode: "auto_apply",
      minConfidence: 0.98,
      maxChangesPerDay: 5,
    },
  ],
};

describe("maybeAutonomouslyApply — policy gate", () => {
  it("executes when policy permits", async () => {
    const { action } = buildAction({ monitorHealthy: true });
    const outcome = await maybeAutonomouslyApply({
      policy: allowPolicy,
      action,
      confidence: 0.99,
      appliedToday: 0,
    });
    expect(outcome).toEqual({ status: "applied_ok", mode: "auto_apply" });
  });

  it("defers to a human — and NEVER calls apply — when policy denies", async () => {
    const { action, log } = buildAction({ monitorHealthy: true });
    const outcome = await maybeAutonomouslyApply({
      policy: allowPolicy,
      action,
      confidence: 0.5, // below threshold
      appliedToday: 0,
    });
    expect(outcome).toEqual({ status: "deferred_to_human", reason: "below_confidence" });
    // The whole point: a denied fix touches nothing — not even the inverse capture.
    expect(log).toEqual([]);
  });

  it("defers when the global kill switch is on", async () => {
    const { action, log } = buildAction({ monitorHealthy: true });
    const outcome = await maybeAutonomouslyApply({
      policy: { ...allowPolicy, globalKillSwitch: true },
      action,
      confidence: 0.99,
      appliedToday: 0,
    });
    expect(outcome).toEqual({ status: "deferred_to_human", reason: "kill_switch" });
    expect(log).toEqual([]);
  });
});
