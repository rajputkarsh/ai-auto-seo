# Superadmin Console (internal, cross-cutting)

> **One-liner:** The staff-only back office for operating the platform across **all** tenants: manage organizations and users, see and adjust **usage/quotas/cost**, manage plans and billing exceptions, suspend abuse, impersonate-for-support (audited), toggle entitlements, and watch system health. Strictly isolated from the customer dashboard and access-controlled by staff role.

**Status:** ☐ Not started. Becomes real in **Phase 2** (once orgs, usage metering, and billing exist). Minimal internal tooling before that is scripts, not a console.

---

## 1. Why this is separate from the Customer Dashboard

| | Customer Dashboard (`apps/web`) | Superadmin Console (`apps/admin`) |
|---|---|---|
| Audience | End users (per-org) | Our staff only |
| Scope | A single organization's data | **All** organizations |
| Auth | Org login (email/SSO) | Separate app + subdomain, staff SSO, **mandatory MFA**, IP allowlist |
| Powers | Review/apply fixes within entitlements | Cross-tenant management, usage/quota overrides, suspension, impersonation |

They share the **data model and API-layer authorization primitives** but are **different apps with different auth realms**. Never merge them — the blast radius of a bug in a cross-tenant admin app is the entire customer base.

---

## 2. Objectives

1. **User & org management** — find, view, and manage any organization and its users.
2. **Usage & quota management** — see per-org consumption (scans, pages, LLM tokens, cost), and **override quotas / grant credits / throttle**.
3. **Plan & billing operations** — change plan, comp/trial-extend, handle refunds/cancellations via Stripe, reconcile.
4. **Abuse & safety controls** — detect and stop crawl abuse, suspend orgs, revoke connections.
5. **Support tooling** — impersonate (audited), inspect an org's scans/findings/outcomes, requeue jobs, re-run scans.
6. **Entitlement/feature flags** — enable/disable capabilities per org (e.g., premium preview detection, autonomy).
7. **System health** — queues, crawler pool, error rates, cost/margin (folds in the Phase-2 internal metrics dashboard).
8. **Auditability** — every staff action recorded immutably.

---

## 3. Staff RBAC (least privilege)

Distinct staff roles — not every operator gets everything:

| Role | Can |
|---|---|
| **Support** | Read org/user data; impersonate (audited); requeue/re-run scans; adjust soft quotas within limits |
| **Billing** | Manage subscriptions, comps, refunds, credits |
| **Engineering** | System health, feature flags, requeue jobs, inspect logs; **no** billing/refunds |
| **SuperAdmin** | Everything, including staff-role management and the global kill switch |

- **Default-deny**; destructive actions (delete data, refunds, org deletion, global kill switch) require the elevated role **and** an explicit confirm + reason (logged).
- **Separation of duties:** the person who can refund is not necessarily the person who can impersonate.

---

## 4. Screens / Capabilities

1. **Org list & search** — by name, domain, email, plan, status; sort by usage/cost/MRR.
2. **Org detail** — profile, plan, users & roles, properties, connections, **usage & cost this period**, quota status, recent scans, billing status, audit of admin actions on this org. Actions: change plan, adjust quota, grant credit, suspend/unsuspend, disable a property, revoke a connection, impersonate.
3. **User detail** — user's orgs/roles, last activity; actions: reset auth, disable user, trigger data export/delete (GDPR).
4. **Usage & billing** — cross-org usage/cost tables, top consumers, margin outliers; Stripe deep-links; comp/refund actions.
5. **Abuse & safety** — flagged orgs (e.g., scanning **unverified** properties, crawl-rate anomalies, cost spikes); one-click throttle/suspend.
6. **Jobs & system health** — BullMQ queue depths, failed jobs (retry/requeue), crawler pool status, LLM budget usage, error rates, **cost/margin dashboard**.
7. **Feature flags / entitlements** — per-org and global toggles.
8. **Audit log** — global, filterable, immutable, exportable.
9. **Global kill switch** — halt all autonomous apply (P5) and, if needed, all crawling.

---

## 5. Impersonation ("view/act as") — handled carefully

Support needs to see what a customer sees, but it's the highest-risk feature:
- **Read-first:** default is read-only "view as"; write actions on the customer's behalf are a separate, higher permission and always audited with reason.
- **Banner + audit:** an active impersonation session is unmistakably marked and fully logged (who, which org, when, what was done).
- **Time-boxed** sessions; auto-expire.
- Never used to access data outside a legitimate support/operational need; logs are reviewable.

---

## 6. Usage & Quota Model

- Consumption is metered in `UsageEvent` (Phase 2): scans, pages crawled, LLM tokens, `cost_cents`.
- Superadmin can view rollups per org/period and **adjust**: raise/lower quotas, grant credits, set a hard cap, or throttle (rate-limit) an org.
- Quota state is enforced by the same entitlement middleware the customer path uses — superadmin edits the entitlement, it takes effect everywhere.
- **Abuse guardrails:** automatic flags for orgs scanning unverified properties, abnormal crawl volume, or cost/margin anomalies; superadmin can throttle or suspend.

---

## 7. Architecture

```
apps/admin (Next.js, separate subdomain)   ── staff SSO + MFA + IP allowlist ──▶
      │  (staff session, staff role)
      ▼
Admin API (namespaced, e.g. /admin/*, staff-authz middleware, cross-tenant)
      │
      ▼
Same Postgres (via @awe/persistence)  +  Stripe  +  BullMQ (jobs)  +  metrics store
      │
      ▼
Immutable Admin Audit Log (append-only)
```

- **Separate app + auth realm** from `apps/web`. Staff identities are distinct from customer identities.
- **Admin API** is namespaced and gated by **staff** authz middleware (never the customer authz path); cross-tenant queries are allowed only here and only for permitted roles.
- Reuses `@awe/persistence`, `@awe/billing`, and the job/metrics infrastructure — no duplicate data layer.

---

## 8. Security & Compliance (this is the crown-jewel surface)

- **Isolation:** separate subdomain/app; staff SSO + **mandatory MFA**; optional IP allowlist/VPN.
- **Least privilege:** staff RBAC (§3); default-deny; destructive actions gated + confirmed + reasoned.
- **Full immutable audit** of every admin action and every impersonation session; audit is tamper-evident and exportable.
- **Data-subject requests:** tooling to export/delete a user's/org's data (GDPR/CCPA), itself audited.
- **Consistent with platform safety rules:** admin actions that change customer public content or billing require explicit staff action with a logged reason; nothing destructive is one-click without confirmation.
- **Break-glass:** an emergency elevated-access path that is loud, time-boxed, and reviewed after the fact.

---

## 9. Per-Phase Rollout (threaded into phase docs)

| Phase | Superadmin scope |
|---|---|
| **2** | **Console v1 (the bulk):** `apps/admin` + staff SSO/MFA + RBAC; org/user list & detail; usage/cost views + **quota override/credits/throttle**; plan/billing ops (Stripe); suspend/unsuspend; impersonation (read-first, audited); jobs/health + cost-margin dashboard; **immutable audit log**. |
| **3** | Manage repo connections (view/revoke); requeue PR/sandbox jobs; per-org feature flag for premium preview detection. |
| **4** | Manage CMS connections (view/revoke); per-org flags for platform adapters. |
| **5** | Autonomy oversight: view/override org autonomy policies; **global kill switch**; autonomous-action audit review. |

---

## 10. Metrics (ops-facing)

- Top consumers by cost; **per-org gross margin**; margin outliers.
- Suspended/abusive orgs; quota-exceeded events.
- Job failure/retry rates; queue depth; crawler pool utilization.
- These complement the program metrics in `00_Overview.md` §4.

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Admin app compromise | Total customer-data breach | Separate app/realm, staff SSO+MFA, IP allowlist, least-privilege RBAC, full audit, break-glass |
| Impersonation misuse | Privacy violation | Read-first, time-boxed, banner + immutable audit, review process |
| Accidental destructive action | Data/revenue loss | Elevated role + confirm + reason; reversible where possible; audit |
| Cross-tenant query bug | Data leak between customers | Admin authz path isolated from customer path; cross-tenant only in `/admin/*`; authz tests required |
| Quota override errors | Margin/abuse exposure | Bounded adjustments per role; SuperAdmin for hard caps; log every change |

---

## 12. Work Breakdown (by phase)

- **P2 (Console v1):** ☐ `apps/admin` scaffold (Next.js, isolated) · ☐ staff SSO + MFA + IP allowlist · ☐ staff RBAC + default-deny · ☐ org/user list & detail · ☐ usage/cost views · ☐ quota override / credits / throttle (via entitlement middleware) · ☐ plan/billing ops (Stripe: comp, refund, cancel) · ☐ suspend/unsuspend + disable property/connection · ☐ impersonation (read-first, audited, time-boxed) · ☐ jobs & system-health + cost/margin dashboard · ☐ **immutable audit log** · ☐ abuse flags (unverified-property scans, crawl/cost anomalies) · ☐ GDPR export/delete tooling · ☐ cross-tenant authz tests.
- **P3:** ☐ repo-connection management + job requeue + premium flag.
- **P4:** ☐ CMS-connection management + adapter flags.
- **P5:** ☐ autonomy-policy oversight + **global kill switch** + autonomous-action audit review.

---

## 13. Definition of Done

- **P2:** Staff (by role, behind SSO+MFA) can find any organization, see and adjust its usage/quotas/cost, manage its plan and billing exceptions, suspend abuse, and impersonate-for-support read-only — with **every action immutably audited**, the admin app isolated from the customer app, and cross-tenant authorization covered by required tests. This is when the platform is operable at scale without shell access to the database.
- **P3–P5:** connection management, feature flags, and autonomy oversight (incl. a global kill switch) are available in the same console, role-gated and audited.
