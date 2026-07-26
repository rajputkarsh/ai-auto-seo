# AI Website Engineer — Phased Implementation Program

This directory decomposes the implementation plan into **phase-wise documents**. Each phase is a self-contained deliverable with its own objectives, architecture, task breakdown, tests, and exit gate. Read this overview first; it defines the phase map, sequencing, cross-cutting standards, and the metrics that gate progression.

**Companion docs:** `../AI_Website_Engineer_Vision_v5.md` (strategy) and `../AI_Website_Engineer_Implementation_Plan.md` (single-page plan this program expands).

---

## 1. The Governing Principle

**Separate intelligence from execution.** The reasoning engine emits an execution-agnostic `RemediationInstruction`; execution adapters apply it. Every phase either deepens the *intelligence* (better detection/reasoning across any stack) or adds an *execution rail* (a new way to apply a fix). No phase couples the two. This is what keeps the platform universal and lets us ship value early and expand without rewrites.

---

## 2. Phase Map

Phases follow the **remediation ladder** — each rung adds automation, trust, stickiness, and pricing power.

| Phase | Title | Remediation rail(s) added | Outcome | Indicative window |
|---|---|---|---|---|
| **1** | Universal Detection & Deterministic Remediation | Recommendation, Patch | Point at any URL → accurate findings + exact fixes. MVP. | Weeks 1–5 |
| **2** | Monitoring, Regression Detection, Persistence, Billing & LLM Reasoner | (hardens rails 1–2) | Continuous "catch it the moment it's live" + first revenue. | Weeks 6–9 |
| **3** | Repository Integration & Framework Adapters | Repo PR/MR | Merge-ready pull requests for git-based sites. | Weeks 10–13 |
| **4** | CMS & Platform Adapters | CMS/Platform update | Fixes written back to WordPress/Shopify/headless. | Months 4–6 |
| **5** | Autonomous Apply | Autonomous | Validate → deploy → monitor → rollback, enterprise-gated. | Months 6–12 |

Beyond Phase 5, the **same engine** expands into new capability domains (performance, accessibility, AI-search, analytics, conversion). Those are separate product lines documented later — not part of this technical-SEO program.

---

## 3. Sequencing & Dependencies

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ──▶ Phase 5
(detect+   (monitor+   (repo PR+   (CMS       (autonomous)
 fix rails) persist+    adapters)   adapters)
            revenue)
```

- **Hard dependency:** each phase builds on the prior one's contracts and data model. Phase 2's persistence underlies everything after it.
- **Revenue gate:** Phase 2 must produce a paying customer and a healthy applied-fix rate before Phase 3 investment.
- **Trust gate:** Phase 5 (autonomous) ships only after Phases 3–4 prove high merge/apply rates in production.
- **Rails are independent by design:** Phase 4 (CMS) and Phase 3 (repo) can be reordered or parallelized based on the design-partner mix, because both consume the same `RemediationInstruction`.

---

## 4. The Metrics That Gate Progression

| Metric | Definition | Gate |
|---|---|---|
| **Rule precision** | Per rule, true positives / (TP + FP) on the golden set | ≥ 95% before a rule ships (all phases) |
| **Applied-fix rate** | Fixes marked applied (or merged) / fixes surfaced | Instrumented in P2; ≥ target before P3 scope-up |
| **Merge-rate-without-edits** | PRs merged unchanged / PRs opened | Primary P3 gate |
| **Gross margin** | 1 − (LLM+compute cost / revenue) | ≥ 80% verified in P2 |
| **Time-to-value** | Install/point-at-URL → first finding | < a few minutes (all phases) |

These are defined once here and referenced by each phase.

---

## 5. Cross-Cutting Standards (apply to every phase)

- **Eval-first for detection.** No detection rule ships without golden-set fixtures proving true-positive **and** true-negative behavior at ≥95% precision. The eval runs in CI (see Phase 1 §Testing).
- **Cost discipline.** Cheap model (`claude-haiku-4-5`) for high-volume classification; capable model (`claude-opus-4-8`) only for generative reasoning/patches, scoped to the finding. Every `Scan`/`RemediationOutput` logs `tokens_in/out` + `cost_cents`.
- **Least privilege & data minimization.** Only crawl verified-owned properties; extract the surface and discard raw HTML after processing; store integration credentials in a secrets manager with minimal scopes.
- **Observability.** Structured logs + error tracking + an internal metrics page tracking the §4 metrics from day one.
- **Human-in-the-loop by default.** Fixes are surfaced/opened for review; autonomous apply (P5) is opt-in and trust-gated.

---

## 6. Tech Stack (locked)

TypeScript everywhere · Node 20+ · Fastify (API) · BullMQ + Redis (queue) · Postgres + Prisma (state) · Playwright (rendering) · Claude (`haiku` detect / `opus` generate) · Stripe (billing) · Fly.io/Railway (hosting) · Docker (sandbox, P3).

Monorepo (pnpm): `packages/*` (libraries) + `apps/*` (services). See the repo `README.md` for the current package layout.

---

## 7. Current Status

**All phases (0–5) have their verifiable core built and tested** (see each phase's §Status) — **328 passing tests**, a CI-enforced **100%-precision** golden-set eval, clean lint + typecheck, across 22 packages + 4 apps.

- **0–2:** universal detect → reason → remediate pipeline; full issue catalog + ownership verification; continuous monitoring with regression detection; persistence; LLM reasoner; billing/entitlements/usage metering; worker job pipeline; customer-dashboard + isolated superadmin.
- **3:** framework adapters (static-HTML, Next.js) + sandbox build gate + repo-PR rail + merge-rate tracker.
- **4:** CMS/platform rail (WordPress + in-memory) with draft-by-default + applied-fix tracker.
- **5:** default-deny autonomy policy engine + reversible-by-construction executor with post-apply monitor and auto-rollback.

**Rails wired into the product (not just libraries).** The P3 repo and P4 CMS rails are reachable through the running API (`/connections/*`, `/remediate/*`, `/remediate/outcomes`) and the customer dashboard's Integrations page — connect a repo or CMS entry, trigger remediation for a URL, and watch the merge-rate / applied-fix outcomes. **Every persistent store is dual-implemented** (in-memory default + Postgres, chosen by `DATABASE_URL`, proven identical by a shared contract test): scan history, subscriptions, usage metering, PR outcomes, CMS outcomes, API keys, and the admin audit trail — all on the single `@awe/persistence` schema.

**Real authentication** (`@awe/auth`) replaces the earlier `x-awe-org` stand-in: org-scoped API keys (hashed at rest, shown once), a fail-closed 401 hook on every non-public route, `apikey`/`dev` modes (production-safe by default), superadmin key management, and a real dashboard sign-in (key → httpOnly cookie → Bearer).

**Detection catalog completed.** The two remaining gaps are closed: **`broken_link`** detection (opt-in HTTP probe of a page's outbound links, injectable + concurrency-capped) and the **`invalid_structured_data` auto-fix** (LLM repairs a single broken JSON-LD block into a verified in-place patch, guarded and fail-soft). Every persistent store — including API keys — is dual-implemented and contract-tested; the only remaining work is operator-owned deployment (live Postgres/Stripe/GitHub/CMS/Anthropic, Docker, SSO/SOC 2) behind the existing seams.

Every rail honours the same invariant: **it never degrades below the universal Recommendation/Patch rails, and never applies an unvalidated or irreversible change.**

**Not yet exercised against live infrastructure** (deferred to the operator, each behind a clean seam with an in-memory/fake default): Docker build/run, live Postgres, Stripe, a real Anthropic API call, BullMQ/Redis, GitHub/GitLab App auth + real Docker sandbox, CMS OAuth + a live WordPress round-trip, and the enterprise controls (SSO/SAML, SOC 2, self-hosted runner). The autonomy executor's `apply`/`captureInverse`/`monitor` are rail-agnostic and attach to the concrete P3/P4 revert mechanisms without changing the tested core.

---

## 8. Glossary

- **SEO Surface** — normalized, framework-agnostic representation of a page's SEO-relevant output, extracted from rendered HTML (`SeoSurface` in `@awe/core`).
- **Finding** — a detected problem with evidence (`Finding`).
- **RemediationInstruction** — execution-agnostic description of the desired fix; the central contract.
- **Remediation Rail / Policy** — one way to apply a fix (recommendation, patch, repo PR, CMS, autonomous), implemented as a `RemediationAdapter`.
- **Property** — a monitored website/domain; the primary billable entity (not a repo).
- **Website Knowledge Graph** — persisted surfaces across scans, enabling site-wide checks and regression deltas.
- **Applied-fix rate / Merge-rate** — the North-Star quality metrics (see §4).

---

## 9. Document Index

1. `Phase_1_Detection_and_Deterministic_Remediation.md`
2. `Phase_2_Monitoring_Regressions_Persistence_Billing.md`
3. `Phase_3_Repository_Integration_and_Framework_Adapters.md`
4. `Phase_4_CMS_and_Platform_Adapters.md`
5. `Phase_5_Autonomous_Apply_Enterprise.md`
6. `Customer_Dashboard.md` — **cross-cutting.** The end-user control surface; role-aware (developer + non-technical owner). Optional read-only report in P1, first-class in P2, deepened each phase. Its tasks are threaded into the phase docs above.
7. `Superadmin_Console.md` — **cross-cutting, internal.** Staff-only cross-tenant back office: manage orgs/users, usage/quotas/cost, plans/billing, abuse/suspension, audited impersonation, system health. Isolated app (`apps/admin`); first-class in P2. Its tasks are threaded into the phase docs above.
