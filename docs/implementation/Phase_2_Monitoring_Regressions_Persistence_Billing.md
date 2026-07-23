# Phase 2 — Monitoring, Regression Detection, Persistence, Billing & LLM Reasoner

> **One-liner:** Turn the one-shot scanner into a continuously-monitored product: crawl any property on a schedule, persist surfaces into a Website Knowledge Graph, detect regressions as surface deltas, swap in an LLM-backed reasoner behind the existing interface, and charge for it — reaching the **first paying customer** with a verified **≥80% gross margin**.

**Status:** **In progress.** Three pieces built and verified without infrastructure:

- ✅ **Regression detection** (`@awe/graph`) — `diffSurfaces` + `mergeFindings`; negative-delta-only, before/after evidence, regression-first ranking.
- ✅ **LLM reasoner + cost governor** (`@awe/reasoning/llm`) — value-based routing (capable model only for generative copy, cheap model only for the ambiguous `noindex` call, rules elsewhere at zero cost), fail-soft fallback, output validation + HTML escaping, spend ceiling with per-call cost telemetry.
- ✅ **Multi-page site scan** (`@awe/crawler.crawlSite` + `@awe/pipeline.runSiteScan`) — sitemap/robots discovery, robots-rule compliance, concurrency cap, global rate limit, page budget; **all surfaces evaluated together** so cross-page rules can fire. Exposed as `POST /site-scan`.
- ✅ **Scan history / persistence** (`@awe/persistence`) — `ScanStore` with an in-memory implementation (the default, so the product works before anyone provisions Postgres) and a Prisma/Postgres implementation. Both pass the **same contract test suite**, so swapping them is configuration, not a code path. Prisma schema validates and the client generates; runtime against a real database is unverified.
- ✅ **Continuous monitoring closed the loop.** `POST /site-scan` now loads the previous surfaces for the property, diffs against them, and saves the new ones — so a second scan reports what *broke* with before/after evidence, without the caller carrying any state. Verified end-to-end: a healthy scan, a deliberate break, then a second scan reporting 2 regressions. `GET /properties/:host/scans` exposes the history.

**Docker:** `Dockerfile` + `docker-compose.yml` provide postgres, redis, api, worker, and a one-shot `verify` service (`pnpm verify:docker`). Authored but **never built or run** — Docker is not installed on the development machine.

**Blocked on infrastructure** (not started): persistence (Postgres), billing (Stripe), the crawler pool at scale, dashboards, and Superadmin console. The LLM path is verified by construction and typecheck but has **not** been exercised against the live API.

---

## 1. Objectives & Exit Gate

**Objectives**
1. **Crawl pipeline at scale:** a Playwright crawler pool that renders a property's pages on demand and on schedule.
2. **Persistence:** Postgres + Prisma storing properties, scans, page surfaces, findings, instructions, outputs, outcomes.
3. **Website Knowledge Graph:** site-wide checks + **regression detection** via surface deltas between scans.
4. **LLM reasoner:** `claude-haiku-4-5` for ambiguous classification + explanation copy, `claude-opus-4-8` for generative fixes — behind the Phase-1 `Reasoner` interface, with strict cost controls.
5. **Billing & entitlements:** Stripe, per-property tiers, usage metering.
6. **Outcome tracking:** the applied-fix metric, live.

**Exit gate**
- A property can be registered, verified, and **continuously monitored**; regressions are detected within one scan cycle of going live.
- **First paying customer** on a paid plan.
- **Applied-fix rate** instrumented and reported.
- **Gross margin ≥ 80%** verified from real `cost_cents` telemetry.

---

## 2. Scope

**In:** crawler pool + scheduler, ownership verification (persisted), Postgres schema + Prisma, knowledge graph + regression deltas, LLM reasoner + cost governor, Stripe billing + entitlement enforcement, usage metering, outcome tracking, metrics/cost dashboard, expanded site-wide rules.

**Out:** repository PRs (P3), framework adapters (P3), CMS write-back (P4), autonomous apply (P5), non-SEO domains.

---

## 3. Architecture

```
        Scheduler (BullMQ repeatable jobs)         On-demand scan (API)
                    │                                      │
                    ▼                                      ▼
             ┌──────────────┐   enqueue crawl      ┌──────────────┐
             │  Scan Planner │────────────────────▶│  Job Queue    │ (BullMQ/Redis)
             └──────────────┘                      └──────┬───────┘
                                                          ▼
                                             ┌──────────────────────┐
                                             │  Crawler Pool         │ (Playwright workers)
                                             │  render → SeoSurface  │
                                             └──────────┬───────────┘
                                                        ▼
                                      ┌──────────────────────────────┐
                                      │ Website Knowledge Graph (PG)  │
                                      │  PageSurface history / routes │
                                      └──────────┬───────────────────┘
                                                 ▼
                       ┌─────────────────────────────────────────────┐
                       │ Detection: rules (current) + regression      │
                       │ deltas (current vs previous surface)         │
                       └──────────┬──────────────────────────────────┘
                                  ▼
                       ┌──────────────────────┐   cost-governed
                       │ LLM / Deterministic   │◀── model router
                       │ Reasoner              │    (haiku/opus)
                       └──────────┬───────────┘
                                  ▼
                      Recommendation / Patch rails  → RemediationOutput → Outcome
```

**New services/packages**
- `@awe/crawler` (exists) → productionized into a **crawler pool** (concurrency-capped, robots-respecting, rate-limited).
- `@awe/persistence` (new) — Prisma client + repositories.
- `@awe/graph` (new) — knowledge-graph queries + regression delta computation.
- `@awe/reasoning` (extend) — add `llmReasoner` implementing `Reasoner`.
- `@awe/billing` (new) — Stripe + entitlements + metering.
- `apps/worker` (exists) → crawl + reason + remediate consumers.
- `apps/api` (extend) — property CRUD, scan triggers, results, billing webhooks.

---

## 4. Crawler Pool

- Playwright (Chromium) workers; provision browsers in the image (`playwright install chromium`).
- **Inputs:** property base URL + sitemap discovery + optional URL allow/deny lists.
- **Politeness:** obey `robots.txt`, per-host concurrency cap, request rate limit, identifiable UA, timeout/retry with backoff.
- **Modes:** `on_demand` (validation/first value) and `scheduled` (monitoring).
- **Output per page:** `{ surface, html, status, fetchedAt }`. Raw HTML is used for the patch rail then discarded post-processing (data minimization); the surface is persisted.
- **Scale target:** horizontally scalable worker count; a scan of N pages fans out across the pool.

**Tasks**
- ☐ Sitemap/URL discovery; crawl budget per plan tier.
- ☐ Concurrency + rate limiting + robots compliance.
- ☐ Failure handling (timeouts, JS errors, non-2xx) recorded as findings where relevant (`statusRule`).
- ☐ Browser lifecycle + memory management in the pool.

---

## 5. Data Model (Postgres / Prisma)

Primary entity is a **Property** (a monitored site); a repo/CMS is an optional `Connection` added later.

```prisma
model Organization { id String @id @default(cuid()) name String plan String @default("free")
  properties Property[] subscription Subscription? usageEvents UsageEvent[] }

model Property { id String @id @default(cuid()) orgId String baseUrl String
  scanFrequency String @default("weekly") verified Boolean @default(false)
  verificationMethod String? verifiedAt DateTime?
  scans Scan[] org Organization @relation(fields:[orgId], references:[id]) }

model Scan { id String @id @default(cuid()) propertyId String trigger String // on_demand|scheduled
  status String startedAt DateTime @default(now()) finishedAt DateTime?
  costCents Int @default(0) surfaces PageSurface[] findings Finding[]
  property Property @relation(fields:[propertyId], references:[id]) }

model PageSurface { id String @id @default(cuid()) scanId String url String route String?
  surface Json fetchedAt DateTime @default(now())
  scan Scan @relation(fields:[scanId], references:[id]) @@index([url]) }

model Finding { id String @id @default(cuid()) scanId String issueType String severity String
  url String route String? message String isRegression Boolean @default(false)
  before Json? after Json? evidence Json?
  instruction RemediationInstruction? scan Scan @relation(fields:[scanId], references:[id]) }

model RemediationInstruction { id String @id @default(cuid()) findingId String @unique
  whatIsWrong String whyItMatters String expectedImpact String confidence Float
  targetChange Json canonicalFix Json outputs RemediationOutput[] }

model RemediationOutput { id String @id @default(cuid()) instructionId String policy String
  artifact String meta Json? outcome Outcome? }

model Outcome { id String @id @default(cuid()) outputId String @unique
  state String // applied|dismissed|superseded  verifiedByRescan Boolean @default(false) resolvedAt DateTime? }

model Subscription { id String @id @default(cuid()) orgId String @unique tier String
  properties Int stripeCustomerId String? stripeSubId String? status String }

model UsageEvent { id String @id @default(cuid()) orgId String kind String costCents Int createdAt DateTime @default(now()) }
```

**Tasks**
- ☐ Prisma schema + migrations; `@awe/persistence` repositories.
- ☐ Persist `SeoSurface` JSON verbatim; keep the TS `SeoSurface` and the `surface Json` column in sync via a zod parser.

---

## 6. Website Knowledge Graph & Regression Detection

- **Site-wide checks** (need all surfaces of a scan): duplicate titles/descriptions across routes, canonical clusters, orphan pages, sitemap-vs-crawled diff. Extends the Phase-1 `siteSurfaces` rule context with persisted data.
- **Regression deltas** — the universal "catch it the moment it's live" mechanism:
  - For each URL, compare the current `SeoSurface` to the most recent prior surface.
  - A **negative delta** → a `Finding` with `isRegression=true`, plus `before`/`after` (e.g., `title` present→absent, `robots.index` true→false, canonical changed/removed, JSON-LD valid→invalid).
  - Regressions are ranked above steady-state issues (they indicate an active, recent harm).

**Contract**
```ts
// @awe/graph
function diffSurfaces(previous: SeoSurface, current: SeoSurface): Finding[];
```

**Tasks**
- ☐ `diffSurfaces` with fixtures per regression type (true-positive + true-negative).
- ☐ Wire prior-surface lookup into `evaluate` via `EvaluateOptions.previous` (interface already exists in `@awe/rules`).
- ☐ Site-wide rules reading persisted surfaces.

---

## 7. LLM Reasoner (behind the existing interface)

Implement `llmReasoner: Reasoner` so the swap is a one-line change in `runScan`.

- **Model router:** `claude-haiku-4-5` for classification/prioritization + human explanation copy (high volume, cheap); `claude-opus-4-8` for generative fixes (e.g., writing a real meta description or title, non-trivial JSON-LD) — low volume, scoped to the finding + relevant HTML fragment only.
- **Determinism guardrail:** rules still detect; the LLM reasons/generates. Never send the whole page tree; cap context size.
- **Cost governor:** per-org monthly token budget; refuse/queue when exceeded; log `tokens_in/out` + `cost_cents` on every call.
- **Validation:** LLM-produced `canonicalFix.html` is schema/shape-checked (valid tag, correct attribute) before it can reach the patch rail.

**Tasks**
- ☐ `llmReasoner` + model router + prompt templates (system prompt cached).
- ☐ Cost governor + budget enforcement + telemetry.
- ☐ A/B the LLM vs deterministic reasoner on the golden set (quality + cost).

---

## 8. Billing & Entitlements

- **Stripe**, billed **per property**. Tiers: Free (1 property, limited patches), Pro (~$99/property/mo), Team/Enterprise (multi-property).
- **Entitlement checks** at scan/remediation time (property count, patch quota, scan frequency) via `Subscription` + `UsageEvent` counters.
- **Metering** already captured in `UsageEvent` for future usage-based add-ons.

**Tasks**
- ☐ Stripe Checkout + customer portal; webhook handling (`apps/api`).
- ☐ Entitlement middleware + quota enforcement.
- ☐ Free-tier limits + upgrade prompts.

---

## 9. Outcome Tracking (the North-Star metric)

- Recommendation/Patch outcomes: user marks **applied** / **dismissed**; a follow-up re-scan of the URL confirms the surface changed as intended (`verifiedByRescan`).
- Compute **applied-fix rate** = applied / surfaced, and **fix correctness** = verified / applied.

**Tasks**
- ☐ Outcome capture endpoints + UI affordance.
- ☐ Re-scan verification job; metric rollups on the dashboard.

---

## 10. Observability, Cost & Metrics Dashboard

- Structured logs + Sentry.
- **Internal metrics page:** scans/day, pages/scan, rule hit-rates & precision (from eval), applied-fix rate, **cost/scan**, **gross margin** (revenue − `cost_cents`).
- Alerting on crawl failure spikes, LLM budget breaches, margin dips.

---

## 11. Security & Privacy

- Scheduled crawl only on **verified** properties (DNS/meta/file proof persisted).
- Discard raw HTML after processing; persist surfaces (minimized).
- Stripe keys + any credentials in a secrets manager; least privilege.
- PII: none expected in surfaces, but scrub/deny-list to be safe.

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LLM cost erodes margin | Kills the 80% target | Haiku for detection, Opus only for generation; per-org budgets; log every call; A/B vs deterministic |
| Regression deltas noisy (intentional changes flagged) | False alarms | Rank by severity; allow per-route baselines/ignores; require negative-only deltas |
| Crawler blocked / rate-limited by targets | Missed pages | Respect robots, backoff, identify UA, per-host caps; surface partial-scan status |
| Prisma/JSON surface drift | Data bugs | zod-parse `surface` on read/write; snapshot tests |
| Billing edge cases (proration, cancellation) | Revenue leakage | Rely on Stripe primitives; webhook-driven state; reconcile job |

---

## 13. Work Breakdown

- **Epic A — Crawler pool & scheduler** (§4)
- **Epic B — Persistence & schema** (§5)
- **Epic C — Knowledge graph & regression deltas** (§6)
- **Epic D — LLM reasoner & cost governor** (§7)
- **Epic E — Billing & entitlements** (§8)
- **Epic F — Outcome tracking & metrics/cost dashboard** (§9–10)
- **Epic G — Security/verification hardening** (§11)
- **Epic H — Customer Dashboard v1** — the first-class, role-aware end-user control surface (`apps/web`, Next.js): auth + org multi-tenancy, onboarding + ownership verification, Home/Property/Findings/Finding-detail, **apply/dismiss** → outcomes, remediation activity, regressions/alerts, Settings (members/RBAC, Stripe portal), WCAG AA. Full spec in `Customer_Dashboard.md` §4–6, §10.
- **Epic I — Superadmin Console v1** — staff-only, cross-tenant back office (`apps/admin`, isolated app): staff SSO+MFA+RBAC, org/user management, **usage/quota/cost overrides**, plan/billing ops (Stripe), suspend/abuse controls, audited impersonation, jobs/system-health + cost-margin dashboard, immutable audit log, GDPR tooling. Full spec in `Superadmin_Console.md` §4–8, §12.

---

## 14. Definition of Done

A user registers and verifies a property; it is crawled on a schedule; regressions are detected within a scan cycle of going live; issues are reasoned (LLM where it adds value, within budget) and delivered via the Recommendation and Patch rails; the user is billed via Stripe with enforced entitlements; outcomes are tracked into an applied-fix rate; and a live dashboard proves **gross margin ≥ 80%** — with **at least one paying customer** onboarded. All rails still consume the unchanged `RemediationInstruction`, leaving Phase 3 (repo PRs) a pure addition.
