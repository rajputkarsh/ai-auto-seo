import { describe, expect, it } from "vitest";
import { type AutonomyPolicy, demoteRule, denyAllPolicy, evaluatePolicy } from "./policy";

const NOW = new Date("2026-06-15T12:00:00Z");

const policy = (over: Partial<AutonomyPolicy> = {}): AutonomyPolicy => ({
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
  ...over,
});

const ctx = (over: Partial<Parameters<typeof evaluatePolicy>[1]> = {}) => ({
  issueType: "missing_canonical",
  confidence: 0.99,
  appliedToday: 0,
  now: NOW,
  ...over,
});

describe("evaluatePolicy — default-deny and fail-closed", () => {
  it("allows a fix that satisfies an explicit rule and every guard", () => {
    expect(evaluatePolicy(policy(), ctx())).toEqual({ mode: "auto_apply" });
  });

  it("denies when there is no rule for the issue (default-deny)", () => {
    expect(evaluatePolicy(policy(), ctx({ issueType: "missing_title" }))).toEqual({
      mode: "deny",
      reason: "no_rule",
    });
  });

  it("a brand-new account (denyAllPolicy) autonomously applies nothing", () => {
    expect(evaluatePolicy(denyAllPolicy("new"), ctx())).toEqual({
      mode: "deny",
      reason: "no_rule",
    });
  });

  it("the global kill switch halts everything, even a permitted rule", () => {
    expect(evaluatePolicy(policy({ globalKillSwitch: true }), ctx())).toEqual({
      mode: "deny",
      reason: "kill_switch",
    });
  });

  it("denies an explicitly denied issue", () => {
    const p = policy({
      rules: [
        { issueType: "missing_canonical", mode: "deny", minConfidence: 0, maxChangesPerDay: 99 },
      ],
    });
    expect(evaluatePolicy(p, ctx())).toEqual({ mode: "deny", reason: "rule_denies" });
  });

  it("denies below the confidence threshold", () => {
    expect(evaluatePolicy(policy(), ctx({ confidence: 0.97 }))).toEqual({
      mode: "deny",
      reason: "below_confidence",
    });
  });

  it("denies once the daily change budget is spent", () => {
    expect(evaluatePolicy(policy(), ctx({ appliedToday: 5 }))).toEqual({
      mode: "deny",
      reason: "budget_exhausted",
    });
  });

  it("denies inside a blackout window and allows outside it", () => {
    const p = policy({
      rules: [
        {
          issueType: "missing_canonical",
          mode: "auto_apply",
          minConfidence: 0.9,
          maxChangesPerDay: 5,
          blackoutWindows: [{ from: "2026-06-15T00:00:00Z", to: "2026-06-16T00:00:00Z" }],
        },
      ],
    });
    expect(evaluatePolicy(p, ctx()).mode).toBe("deny");
    expect(evaluatePolicy(p, ctx({ now: new Date("2026-06-20T12:00:00Z") })).mode).toBe(
      "auto_apply",
    );
  });

  it("fails closed on an unparseable blackout window", () => {
    const p = policy({
      rules: [
        {
          issueType: "missing_canonical",
          mode: "auto_apply",
          minConfidence: 0.9,
          maxChangesPerDay: 5,
          blackoutWindows: [{ from: "not-a-date", to: "also-bad" }],
        },
      ],
    });
    expect(evaluatePolicy(p, ctx())).toEqual({ mode: "deny", reason: "blackout_window" });
  });

  it("passes through auto_apply_deploy for the closed-loop level", () => {
    const p = policy({
      rules: [
        {
          issueType: "missing_canonical",
          mode: "auto_apply_deploy",
          minConfidence: 0.98,
          maxChangesPerDay: 5,
        },
      ],
    });
    expect(evaluatePolicy(p, ctx())).toEqual({ mode: "auto_apply_deploy" });
  });
});

describe("demoteRule", () => {
  it("flips a misbehaving issue's rule to deny without touching others", () => {
    const p = policy({
      rules: [
        {
          issueType: "missing_canonical",
          mode: "auto_apply",
          minConfidence: 0.98,
          maxChangesPerDay: 5,
        },
        {
          issueType: "noindex_unexpected",
          mode: "auto_apply",
          minConfidence: 0.98,
          maxChangesPerDay: 5,
        },
      ],
    });
    const demoted = demoteRule(p, "missing_canonical");
    expect(evaluatePolicy(demoted, ctx())).toEqual({ mode: "deny", reason: "rule_denies" });
    // The other rule is untouched.
    expect(evaluatePolicy(demoted, ctx({ issueType: "noindex_unexpected" })).mode).toBe(
      "auto_apply",
    );
    // Original policy is not mutated.
    expect(evaluatePolicy(p, ctx()).mode).toBe("auto_apply");
  });
});
