# Customer Dashboard (cross-cutting)

> **One-liner:** The end-user control surface. Not a report to stare at — the place customers add properties, see findings and regressions, and **apply/approve fixes** across whatever rails their stack supports. One dashboard, **role-aware**: it adapts to the connected stack (repo vs CMS) and the user's role, serving a developer and a non-technical site owner from the same product.

**Status:** ☐ Not started (minimal read-only report optional in Phase 1; first-class in Phase 2). This is a **cross-cutting surface** that deepens every phase — its tasks are threaded into the phase docs.

---

## 1. Positioning: control surface, not "a dashboard company"

The vision says *"not another SEO dashboard."* That is about **value** — we don't sell read-only reports and spreadsheets. It does **not** mean "no UI." The dashboard here is the **control surface** for the real value (fixes + outcomes): review a finding, understand it, apply the fix, watch it verified. Reports are a side effect, not the product.

This distinction resolves the apparent contradiction: we reject the *dashboard-as-product* while still building an excellent *dashboard-as-control-surface*.

---

## 2. Why role-aware (and why one dashboard)

The universal thesis pulls in two very different users; the CMS phases (P4) make the non-technical segment large:

| Persona | Lives in | Needs from the dashboard |
|---|---|---|
| **Developer** (Next.js/git teams) | CLI, CI, PRs | Thin companion: scan history, PR/merge status, config, tokens, ignore rules |
| **Non-technical owner** (WordPress/Shopify/marketing) | A web UI, full stop | Primary surface: plain-language findings, **one-click apply/approve**, impact, trends |

We build **one** dashboard with **role-aware views** rather than two products, because both consume the same underlying data (properties → scans → findings → instructions → outcomes). The view emphasizes different rails and language based on:
- **Connected stack** — repo connected → show PR affordances; CMS connected → show draft-approve affordances; neither → show snippet/patch (copy/apply).
- **User role** — Owner/Admin (billing, members, integrations, autonomy policy) vs Member (review/apply within entitlements).
- **Persona hint** — captured at onboarding to bias default language (technical vs plain), overridable.

---

## 3. Information Architecture (screens)

1. **Onboarding** — add a property (URL) → verify ownership (DNS/meta/file) → run first scan → optional connect repo/CMS → persona hint.
2. **Home / Overview** — per-property health, open-findings count by severity, recent regressions, applied-fix trend, plan/usage.
3. **Property detail** — scan history, page list with per-page surface, next scheduled scan, config (frequency, URL allow/deny, ignores).
4. **Findings** — filterable list (severity, type, route, regression-only). Regressions ranked first with "new since <date>".
5. **Finding detail** — what's wrong / why it matters / expected impact / confidence, before→after for regressions, and the fix **rendered per available rail**:
   - Recommendation snippet (copy) — always.
   - Patch (unified diff, download/copy) — always when patchable.
   - "Open PR" / PR status — when repo connected.
   - "Approve draft" + `reviewUrl` — when CMS connected.
   - Actions: **Apply / Dismiss / Snooze**, each recorded as an `Outcome`.
6. **Remediation activity** — history of outputs + outcomes; applied-fix rate and (repo) merge-rate; "verified by re-scan" badges.
7. **Regressions / Alerts** — timeline of regressions with notification settings (email/Slack).
8. **Integrations** — connect/disconnect GitHub/GitLab/CMS; connection health; scopes.
9. **Settings** — Team & roles (RBAC), Billing & plan (Stripe portal), API tokens, Notifications, **Autonomy policy** (P5).

---

## 4. Per-Phase Rollout (threaded into the phase docs)

| Phase | Dashboard scope |
|---|---|
| **1** | Read-only **report** (optional): scan a URL → findings + recommendation/patch. Validation only; API + CLI are the source of truth. |
| **2** | **Dashboard v1 (first-class):** auth + multi-tenant orgs, onboarding + ownership verification, Home, Property detail, Findings, Finding detail with **apply/dismiss**, Remediation activity, regressions/alerts, Settings (members/RBAC, billing via Stripe portal, notifications). |
| **3** | Repo affordances: connect repo, **Open PR** action + PR/merge status, merge-rate view. |
| **4** | CMS affordances: connect CMS, **approve draft** review flow (the non-technical owner's primary surface), `reviewUrl` surfacing. |
| **5** | Autonomy: policy editor (per-issue allowlist, confidence thresholds, change budgets, blackout windows), audit log viewer, **kill switch**. |

---

## 5. Tech & Architecture

- **`apps/web` — Next.js (App Router).** We dogfood our own primary target framework (and our own SEO/accessibility standards — our site must be exemplary).
- **Data via `apps/api`** (the Phase-2 persistence layer). Server Components read through the API; mutations (apply/dismiss, connect, policy) call API endpoints. No direct DB access from the web app.
- **Auth:** email/password + magic link at first; SSO/SAML in P5 (enterprise). Session → org scoping on every request.
- **Multi-tenancy:** every query is org-scoped; row-level authorization enforced in the API, never trusted from the client. Property/finding/outcome access checked against the caller's org + role.
- **Design system:** minimal, accessible component set (e.g., Tailwind + headless primitives). **WCAG 2.1 AA** target — non-negotiable, since we sell quality and accessibility is a future capability domain we must model.
- **Real-time-ish:** scan progress + new findings via polling first; upgrade to SSE/websockets if needed.

---

## 6. API Surface the Dashboard Needs

Mostly satisfied by Phase 2 persistence; listed here so the API is designed for the UI, not retrofitted.

```
POST   /properties                      create + start verification
POST   /properties/:id/verify           check ownership proof
GET    /properties[/:id]                list / detail
POST   /properties/:id/scan             trigger on-demand scan
GET    /scans/:id                        scan status + summary
GET    /properties/:id/findings          filter: severity,type,route,regression
GET    /findings/:id                      detail + rendered rails
POST   /outcomes                          { outputId, state: applied|dismissed|snoozed }
GET    /remediation/activity             outputs + outcomes + rates
POST   /connections                       github|gitlab|cms (OAuth start)
GET    /connections                       status/health
GET    /org/members  POST /org/invites   RBAC
GET    /billing/portal                    Stripe customer portal link
# P5:
GET/PUT /org/autonomy-policy              policy editor
GET    /org/audit-log                     autonomous action audit
POST   /org/kill-switch                   halt autonomy
```

---

## 7. Security & Privacy

- Org-scoped, role-checked authorization on **every** endpoint (server-side; client role is a hint only).
- Least-privilege by role: Members can review/apply within entitlements; only Owners/Admins touch billing, integrations, and autonomy policy.
- No secrets in the browser; OAuth handled server-side; API tokens shown once.
- Consistent with the platform safety rules: publishing/applying a fix that changes public content requires an explicit user action in the UI (or an approved autonomy policy in P5); nothing outward-facing happens silently.

---

## 8. Metrics (dashboard-specific)

- **Activation:** % of new orgs that reach *first fix applied* (not just first scan).
- **Time-to-first-applied-fix** from signup.
- **Weekly active reviewers**; findings-reviewed / findings-surfaced.
- These complement the program metrics (applied-fix rate, merge-rate) in `00_Overview.md` §4.

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Building UI too early (pre-persistence) | Wasted work | Real dashboard starts in P2 when accounts/persistence exist; P1 is an optional read-only report |
| "Yet another dashboard" perception | Positioning muddle | Frame as control surface for fixes/outcomes; lead with actions, not charts |
| Role-aware complexity | Slow build | One data model, view-level adaptation only; ship developer + owner defaults, refine later |
| Multi-tenant authz bugs | Data leak | Server-side org scoping + row-level checks; authz tests as a required gate |
| Accessibility debt | Hypocritical for a quality product | WCAG AA from the start; a11y checks in CI |

---

## 10. Work Breakdown (by phase)

- **P1:** ☐ Optional read-only report view (scan → findings + snippet/patch).
- **P2 (Dashboard v1 — the bulk):** ☐ `apps/web` scaffold (Next.js) · ☐ auth + org multi-tenancy · ☐ onboarding + ownership verification UI · ☐ Home/Overview · ☐ Property detail · ☐ Findings list + detail · ☐ apply/dismiss/snooze → outcomes · ☐ remediation activity · ☐ regressions/alerts + notifications · ☐ Settings (members/RBAC, Stripe portal) · ☐ authz tests · ☐ WCAG AA baseline + CI a11y check.
- **P3:** ☐ connect repo UI · ☐ Open-PR action + PR/merge status · ☐ merge-rate view.
- **P4:** ☐ connect CMS UI · ☐ draft review + approve flow · ☐ `reviewUrl` surfacing.
- **P5:** ☐ autonomy policy editor · ☐ audit-log viewer · ☐ kill switch.

---

## 11. Definition of Done (per phase)

- **P2:** A non-technical owner and a developer can each sign up, add and verify a property, see findings in language suited to them, and **apply or dismiss a fix** that is then verified by re-scan — all org-scoped and access-controlled, meeting WCAG AA. This is when the dashboard becomes a first-class, sellable surface.
- **P3–P5:** each rail's actions (open PR, approve CMS draft, set autonomy policy) are available from the same dashboard, role-gated, with status and audit visible — so every remediation rail has a human control surface, not just an API.
