# Phase 5 — Autonomous Apply (Enterprise)

> **One-liner:** The top rung of the remediation ladder: for trusted, high-confidence fixes on enterprise accounts, close the loop automatically — **validate → apply → deploy → monitor → auto-rollback** — behind strict policy gates, full auditability, and enterprise trust controls (SSO, SOC 2, self-hosted runner). Same `RemediationInstruction`; the difference is that a human no longer has to click "apply."

**Status:** ☐ Not started. Ships **only after** Phases 3–4 demonstrate consistently high merge/apply rates and correctness in production. This is the most trust-sensitive phase — under-build it deliberately.

---

## 1. Objectives & Exit Gate

**Objectives**
1. **Policy engine:** per-account, per-issue-type rules deciding what may be applied autonomously (confidence thresholds, allowlists, change budgets).
2. **Autonomous executor:** apply an already-validated fix (via the P3 repo rail or P4 CMS rail) without human approval, when policy permits.
3. **Post-apply monitoring & auto-rollback:** watch surface + health signals after apply; revert automatically on regression or failure.
4. **Enterprise trust controls:** SSO/SAML, SOC 2 Type II, self-hosted runner option, comprehensive audit log, kill switch.

**Exit gate**
- Autonomous apply runs for a defined, narrow allowlist of high-confidence issue types on ≥1 enterprise account, with **zero un-reverted incidents**.
- Every autonomous action is auditable and reversible; a global kill switch halts autonomy instantly.
- SSO + audit log + self-hosted runner available; SOC 2 in place or in audit.

---

## 2. Scope

**In:** policy/guardrail engine, autonomous executor over existing P3/P4 rails, post-apply monitoring + auto-rollback, approval-workflow integration (staged autonomy), enterprise controls (SSO, audit, self-hosted runner, kill switch), SOC 2 groundwork.

**Out:** any new *detection* or *reasoning* capability (unchanged from prior phases); autonomy for low-confidence or unvalidated fixes (never); new capability domains.

---

## 3. Trust Model & Staged Autonomy

Autonomy is earned and granular, never global-by-default:

```
Level 0  Recommend            (P1)  human does everything
Level 1  Propose PR/draft     (P3/P4) human approves each
Level 2  Auto-apply allowlist (P5)  human sets policy; system applies matching high-confidence fixes
Level 3  Auto-apply + auto-deploy + auto-rollback (P5)  fully closed loop within policy
```

- Accounts start at Level 1 and opt up per issue type after observing a track record.
- Policy is **default-deny**: nothing is autonomous unless explicitly allowed.

---

## 4. Architecture

```
RemediationInstruction (validated by P3 sandbox gate or P4 draft+verify)
        │
        ▼
Policy Engine:  allowed(account, issueType, confidence, changeBudget)?  ── no ─▶ fall to Level 1 (human approval)
        │ yes
        ▼
Autonomous Executor:
   repo rail → merge validated PR   |   CMS rail → publish approved-by-policy change
        │
        ▼
Deploy watch (where applicable) ──▶ Post-Apply Monitor:
   re-scan surface + health/error/CWV signals over a window
        │
   regression/failure? ── yes ─▶ Auto-Rollback (revert PR / restore CMS field) + alert + demote autonomy
        │ no
        ▼
Outcome: auto_applied_ok  (audited)
```

**New packages/services**
- `@awe/policy` — guardrail/policy engine + evaluation.
- `@awe/autonomy` — executor + post-apply monitor + rollback controller.
- `@awe/enterprise` — SSO, audit log, self-hosted-runner coordination, kill switch.

---

## 5. Policy / Guardrail Engine

Per-account policy specifying, for each issue type: min confidence, allow/deny, max autonomous changes per window (**change budget**), blackout windows (e.g. no autonomy during a launch freeze), and required validations.

```ts
// @awe/policy
interface AutonomyPolicy {
  accountId: string;
  rules: {
    issueType: string;
    mode: "deny" | "auto_apply" | "auto_apply_deploy";
    minConfidence: number;          // e.g. 0.98
    maxChangesPerDay: number;
    blackoutWindows?: string[];     // cron-like
  }[];
  globalKillSwitch: boolean;
}
function allowed(policy: AutonomyPolicy, ctx: { issueType: string; confidence: number; appliedToday: number }): "auto_apply" | "auto_apply_deploy" | "deny";
```

- **Fail-closed:** any ambiguity, missing validation, or budget breach → `deny` → human approval path.
- Changes require an **already-validated** artifact (P3 sandbox-passed PR or P4 verified draft); autonomy never bypasses validation.

---

## 6. Post-Apply Monitoring & Auto-Rollback

- After apply/deploy, monitor over a window: re-extract the surface (issue resolved? new findings?), plus health signals (error rate, Core Web Vitals deltas, non-2xx spikes) where available.
- **Auto-rollback** on any regression/failure: revert the PR (revert commit / close-and-restore) or restore the prior CMS field value; alert; **demote** the account/issue-type autonomy level pending review.
- Every apply has a pre-computed, tested inverse (revert plan) before it runs.

**Tasks**
- ☐ Post-apply monitor (surface + health signals) with a configurable window.
- ☐ Reversible-by-construction executor: compute + store the inverse before applying.
- ☐ Auto-rollback controller + autonomy demotion + alerting.

---

## 7. Enterprise Trust Controls

- **SSO/SAML** + SCIM provisioning; role-based access (who can set policy, who can flip the kill switch).
- **Audit log:** immutable record of every autonomous decision and action (policy evaluated, artifact applied, monitor result, rollback if any) — exportable.
- **Self-hosted runner:** option to run the sandbox/executor inside the customer's own environment (their code/secrets never leave their perimeter).
- **Global + scoped kill switches:** instant halt of all autonomy (global) or per-account/issue-type.
- **SOC 2 Type II:** controls, evidence, and audit (groundwork began in P3).

**Tasks**
- ☐ SSO/SAML + SCIM + RBAC.
- ☐ Immutable audit log + export.
- ☐ Self-hosted runner packaging + coordination protocol.
- ☐ Kill-switch (global/scoped) with instant propagation.
- ☐ SOC 2 controls + audit engagement.

---

## 8. Security & Safety

- Default-deny policy; validated-artifact-only; reversible-by-construction; fail-closed everywhere.
- Blast-radius limits: change budgets, blackout windows, per-issue allowlists.
- Separation of duties: setting policy, approving autonomy level, and flipping the kill switch are distinct RBAC permissions.
- Full audit + rollback = every autonomous action is reversible and accountable.

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Autonomous change causes a production incident | Severe trust/revenue damage | Validated-only + reversible-by-construction + post-apply monitor + auto-rollback + change budgets |
| Policy misconfiguration opens too much | Unintended mass changes | Default-deny, conservative defaults, dry-run/preview of policy, change budgets, blackout windows |
| Rollback itself fails | Stuck bad state | Pre-computed tested inverse before apply; alert + manual runbook; kill switch |
| Enterprise security objections | Deals stall | Self-hosted runner, SSO, SOC 2, audit export, kill switch |
| Over-trust from a good track record | Complacency → eventual incident | Periodic re-validation, capped budgets, mandatory monitoring window regardless of history |

---

## 10. Work Breakdown

- **Epic A — Policy/guardrail engine** (§5)
- **Epic B — Autonomous executor (reversible-by-construction)** (§6)
- **Epic C — Post-apply monitor + auto-rollback** (§6)
- **Epic D — Enterprise controls: SSO, audit, self-hosted runner, kill switch** (§7)
- **Epic E — SOC 2 Type II** (§7)
- **Epic F — Staged-autonomy UX (opt-up per issue type)** (§3)
- **Epic G — Dashboard: autonomy controls** — policy editor (allowlist, confidence thresholds, change budgets, blackout windows), audit-log viewer, and **kill switch** (`Customer_Dashboard.md` §4 P5).

---

## 11. Definition of Done

For a trusted enterprise account, a narrow allowlist of high-confidence, **already-validated** technical-SEO fixes is applied autonomously under a default-deny policy engine, monitored after apply, and **auto-reverted on any regression** — with a global kill switch, immutable exportable audit log, SSO, and a self-hosted-runner option, and **zero un-reverted incidents** across the pilot. The platform now spans the full remediation ladder — recommend, patch, PR, CMS, autonomous — all on the one unchanged intelligence core, fulfilling the North Star: an AI engineer that can, where trusted, continuously keep a production website correct on its own.
