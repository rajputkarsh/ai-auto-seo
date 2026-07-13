# AI Website Engineer — Implementation Plan (Universal)

**Scope:** how to build the v5 MVP — a **universal**, tech-agnostic technical-SEO engine that scans any website, reasons about issues, and delivers fixes through a **pluggable remediation layer** (starting with Recommendation + AI Patch, no adapters). Companion to `AI_Website_Engineer_Vision_v5.md`.

**Guiding principle:** the AI reasoning engine **never knows how a fix is applied.** It emits structured, execution-agnostic remediation instructions. Execution adapters turn those into snippets, diffs, PRs, CMS writes, or deploys.

---

## 0. Assumptions & Non-Goals

**Stack (locked unless vetoed):**
- **TypeScript everywhere.**
- **LLM:** Claude — `claude-haiku-4-5` for high-volume detection/classification, `claude-opus-4-8` for reasoning + patch generation. Anthropic SDK.
- **Crawler:** Playwright (headless Chromium) for rendered-HTML extraction — this is what makes detection universal.
- **Runtime:** Node 20 + Fastify (API), BullMQ + Redis (queue), Postgres + Prisma (state).
- **Hosting:** Fly.io / Railway; managed Postgres + Redis.

**In scope (MVP / Phase 1):** universal scan of any URL; the core technical-SEO issue set; AI reasoning with confidence + impact; **Policy 1 (Recommendation)** and **Policy 2 (AI Patch / unified diff)**. No repository, framework, or CMS adapters required.

**Explicit non-goals for MVP:** repository PRs, framework/CMS adapters, autonomous apply, pre-deploy prevention, non-SEO capability domains. All are later phases layered on the *same* engine.

---

## 1. Architecture Overview

```
   Any URL (prod / staging / preview)          Optional: connected repo / CMS
              │                                             │
              ▼                                             ▼
   ┌────────────────────┐                        ┌────────────────────┐
   │ Universal Crawler  │  rendered HTML         │  Source/CMS Reader  │ (Phase 2+)
   │ (Playwright)       │───────────┐            └─────────┬──────────┘
   └────────────────────┘           ▼                      │
                          ┌────────────────────┐           │
                          │  SEO Surface        │◀──────────┘
                          │  Extractor          │  (universal from rendered output)
                          └─────────┬───────────┘
                                    ▼
                          ┌────────────────────┐
                          │ Website Knowledge   │  routes, surfaces, deltas
                          │ Graph (Postgres)    │
                          └─────────┬───────────┘
                                    ▼
                          ┌────────────────────┐
                          │ AI Reasoning Engine │  → RemediationInstruction
                          │ (rules + Claude)    │    {issue, why, impact, confidence, fix}
                          └─────────┬───────────┘
                                    ▼
                 ┌──────────────────────────────────────────┐
                 │        Remediation Layer (pluggable)      │
                 │  ┌────────────┬────────┬────────┬───────┐ │
                 │  │Recommend.  │ Patch  │ Repo PR│ CMS   │ │
                 │  │(MVP)       │ (MVP)  │(Ph 2/3)│(Ph 3) │ │
                 │  └────────────┴────────┴────────┴───────┘ │
                 └──────────────────────────────────────────┘
                                    │
                          ┌────────────────────┐
                          │  Outcome Tracker    │  applied? dismissed? impact?
                          └────────────────────┘
```

**Core flow (universal):**
1. Customer registers a **property** (a domain/URL) or triggers a scan.
2. **Universal Crawler** renders pages and captures HTML output.
3. **SEO Surface Extractor** normalizes each page into a `SeoSurface` from the rendered output — *no framework knowledge needed*.
4. Surfaces land in the **Website Knowledge Graph**; regressions are deltas between two scans of the same route (or base vs. head where a preview URL exists).
5. **AI Reasoning Engine** turns findings into structured `RemediationInstruction`s (issue, why, impact, confidence, canonical fix).
6. **Remediation Layer** renders each instruction through the customer's chosen policy — MVP: a recommendation card and/or a unified diff.
7. **Outcome Tracker** records what was applied and the measured effect.

---

## 2. Component Deep-Dives

### 2.1 Universal Crawler (Playwright)
- Renders each target URL in headless Chromium → captures final DOM/HTML (handles SPA/CSR sites, which raw-HTML fetch would miss). This is the key to universality: we read *output*, so backend tech is irrelevant.
- Inputs: a property's URL, a sitemap, or a supplied URL list. Politeness: robots-respecting, rate-limited, concurrency-capped.
- Modes: **on-demand scan** (validation/first value) and **scheduled/continuous** (monitoring — the universal way to catch regressions "the moment they're live").

### 2.2 SEO Surface Extractor (universal)
The "SEO surface" is a normalized representation of a page's SEO-relevant output. Extracted from **rendered HTML** → works on any stack.

```ts
type SeoSurface = {
  url: string;
  route?: string;                          // grouped pattern, e.g. /blog/:slug
  title?: string;
  description?: string;
  canonical?: string | null;
  robots?: { index: boolean; follow: boolean };
  openGraph?: Record<string, string>;
  twitter?: Record<string, string>;
  jsonLd?: Array<{ type: string; valid: boolean; errors?: string[] }>;
  headings?: { h1Count: number };
  hreflang?: Array<{ lang: string; href: string }>;
  siteWide?: {                             // fetched once per property
    robotsTxt?: RobotsRule[];
    sitemapPresent?: boolean;
    sitemapUrlCount?: number;
  };
  status?: number;                         // HTTP status, redirects
};
```

Optional **Source/CMS Reader** (Phase 2+) enriches the surface where a repo/CMS is connected, but the extractor never *depends* on it.

### 2.3 Website Knowledge Graph
- Persist surfaces per (property, route, scan). Enables: current-state audit, **regression detection** (surface delta between two scans), site-wide checks (duplicate titles across routes, orphan pages, canonical clusters), and trend history.
- This is the "repository intelligence / knowledge graph" differentiator — but built from output, so it exists for every site.

### 2.4 AI Reasoning Engine → RemediationInstruction
- **Rules engine first** (deterministic, cheap, high precision) for the known issue catalog (§4). Handles the majority with zero LLM cost.
- **Claude assist** for: prioritization/impact reasoning, ambiguous cases, and generating the human explanation. Haiku for classification; Opus for the fix content.
- Output is **execution-agnostic**:
```ts
type RemediationInstruction = {
  issueType: string;
  severity: "low" | "medium" | "high";
  route: string;
  whatIsWrong: string;
  whyItMatters: string;
  expectedImpact: string;
  confidence: number;                      // 0–1
  targetSurfaceChange: Partial<SeoSurface>;// the desired end-state, not a mechanism
  canonicalFix: {                          // rendered per policy by the exec layer
    html?: string;                         // e.g. the exact <link rel="canonical" ...>
    diffHint?: string;                     // guidance for patch/PR rails
  };
};
```
The engine describes the **desired outcome**; it does not decide *how* it's applied.

### 2.5 Remediation Layer (pluggable execution)
A common interface; one adapter per policy. MVP ships the first two.

```ts
interface RemediationAdapter {
  policy: "recommendation" | "patch" | "repo_pr" | "cms" | "autonomous";
  supports(context: SiteContext): boolean;
  render(instruction: RemediationInstruction, ctx: SiteContext): Promise<RemediationOutput>;
}
```
- **Policy 1 — Recommendation (universal):** render the instruction as a card — what/why/impact/confidence + the exact snippet to apply. Zero risk, works everywhere.
- **Policy 2 — AI Patch (MVP default):** produce a **standard unified diff** the developer applies anywhere (`<title>`, `<link rel=canonical>`, meta, JSON-LD block). Framework-independent; reviewable; builds trust.
- **Policy 3 — Repo PR/MR (Phase 2–3):** same instruction → GitHub/GitLab/Bitbucket adapter → PR, validated by a **sandbox build gate** before it's surfaced.
- **Policy 4 — CMS update (Phase 3):** write the corrected field via WordPress/Shopify/headless API.
- **Policy 5 — Autonomous (Phase 4):** validate → deploy → monitor → optional rollback. Enterprise, trust-gated.

Because policies share the instruction contract, **adding a rail never touches the reasoning engine.**

### 2.6 Outcome Tracker
- Recommendation/Patch: track "marked applied / dismissed" + re-scan the route to confirm the surface changed as intended.
- Repo/CMS/Autonomous (later): resolve merged/edited/deployed + measure surface + downstream metrics.
- Feeds the North-Star metric: **applied-fix rate & fix correctness**, and (later) measured impact.

---

## 3. Data Model (Postgres / Prisma)

Primary entity is a **Property (a monitored site)** — a repo is an *optional* connection, not the anchor.

| Table | Key fields |
|---|---|
| `Organization` | id, name, plan |
| `Property` | id, org_id, base_url, scan_frequency, status |
| `Connection` | id, property_id, kind(github/gitlab/cms/edge), credentials_ref *(optional)* |
| `Scan` | id, property_id, trigger(ondemand/scheduled/webhook), status, started/finished_at |
| `PageSurface` | id, scan_id, url, route, surface(jsonb) |
| `Finding` | id, scan_id, issue_type, severity, route, before, after |
| `RemediationInstruction` | id, finding_id, what/why/impact, confidence, target_change(jsonb), canonical_fix(jsonb) |
| `RemediationOutput` | id, instruction_id, policy, artifact(diff/snippet/pr_url), status |
| `Outcome` | id, output_id, state(applied/dismissed/…), verified_by_rescan, resolved_at |
| `Subscription` | id, org_id, tier, properties, billing_id, status |
| `UsageEvent` | id, org_id, kind, cost_cents, created_at |

Indices on `(property_id, scan.started_at)`, `(page_surface.route)`, `Outcome.state`.

---

## 4. Issue Catalog (MVP — universal, output-based)

| # | Issue | Rendered-output signal | Fix rail |
|---|---|---|---|
| 1 | Missing/duplicate title or meta description | absent/empty; or identical across routes | Recommendation + Patch |
| 2 | Missing/incorrect canonical | absent, malformed, or points off-site unexpectedly | Recommendation + Patch |
| 3 | Robots/sitemap problems | `noindex` where indexable expected; robots.txt blocks; sitemap missing/stale | Recommendation + Patch |
| 4 | Invalid/missing structured data | JSON-LD absent or schema-invalid | Recommendation + Patch |
| 5 | Broken internal links / bad status | 4xx/5xx, redirect chains, links to dead routes | Recommendation (fix-source later) |
| 6 | Missing/duplicate H1, missing OG/Twitter | count/absence from DOM | Recommendation + Patch |

Regression variants (issue newly introduced vs. a prior scan) come free from surface deltas in the knowledge graph. Each rule ships with fixtures proving true-positive **and** true-negative before going live — precision is the product.

---

## 5. LLM Usage & Cost Controls

- **Detection:** rules-only for the common path; Haiku only for ambiguous classification + explanation copy. Target < $0.05/scan-page-batch.
- **Patch/reasoning:** Opus, scoped to the single finding + the relevant HTML fragment — never the whole page tree.
- **Guardrails:** per-property token budget; cap on context size; skip assets/binaries.
- Log `tokens_in/out` + `cost_cents` on every `Scan`/`RemediationOutput` → live gross-margin visibility.

---

## 6. Eval & QA (gates the roadmap)

1. **Golden site set:** 15–20 real websites across stacks (WordPress, Shopify, Next.js, static HTML, .NET) with known/seeded issues → measure **precision & recall per rule**. Ship a rule at ≥95% precision.
2. **Patch-correctness harness:** apply each generated diff to a captured HTML fixture → re-extract surface → assert the issue is resolved and nothing regressed.
3. **Applied-fix instrumentation** (from §2.6) is the production metric; go/no-go for scope expansion.
4. Golden-set eval runs in our own CI — a regression in *our* detector fails *our* build.

---

## 7. Security & Privacy

- Crawler respects robots, rate limits, identifies itself; only crawls properties the org has verified ownership of (DNS/meta-tag/file verification before scheduled crawls).
- No persisted raw page bodies beyond a scan's processing window — extract surface, discard HTML.
- Optional connections (repo/CMS creds) stored in a secrets manager, encrypted at rest, least-privilege scopes; introduced only in Phase 2+.
- Sandbox isolation for the future Repo-PR build gate (ephemeral, secretless, egress-restricted).

---

## 8. Billing & Entitlements

- **Stripe**, billed **per property**. Free = 1 property + limited patches; Pro = continuous monitoring + unlimited patches; Team/Enterprise = multi-property + integrations + autonomous.
- Entitlement + `UsageEvent` metering enforced at scan/remediation time. Metering already in place for future usage tiers.

---

## 9. Infra & Deployment

- **Services:** `api` (Fastify), `worker` (BullMQ: crawl + reason + remediate), plus a **crawler pool** (Playwright workers, horizontally scalable). Split so crawls never block API acks.
- **CI/CD:** GitHub Actions → deploy on merge; golden-set eval a required check.
- **Observability:** structured logs, Sentry, internal metrics page (scans/day, precision, applied-fix rate, cost/scan, gross margin).

---

## 10. Milestones (→ first revenue on a universal MVP)

**Phase 1 · Weeks 1–5 — Universal detection + reasoning (Recommendation rail)**
- [ ] Property registration + ownership verification.
- [ ] Universal Crawler (Playwright) + SEO Surface Extractor.
- [ ] Knowledge Graph + rules engine + issue catalog (§4) with fixtures.
- [ ] AI Reasoning → `RemediationInstruction` (what/why/impact/confidence).
- [ ] Recommendation UI (findings + exact snippet) + on-demand scan.
- **Exit:** point at any URL (any stack) → accurate findings + explanations. Precision ≥95% on golden set.

**Phase 2 · Weeks 6–9 — AI Patch rail + monitoring + billing**
- [ ] Patch adapter: deterministic unified diffs, validated against captured HTML fixtures.
- [ ] Scheduled/continuous crawl → regression detection via surface deltas.
- [ ] Outcome Tracker + applied-fix metric; Stripe billing + entitlements; free tier live.
- **Exit:** first paying customer; applied-fix rate instrumented; gross margin verified ≥80%.

**Phase 3 · Weeks 10–13 — Repository integration (Policy 3, opt-in)**
- [ ] GitHub/GitLab connection → PR/MR from the same instructions + sandbox build gate.
- [ ] First framework adapters (Next.js, static HTML) for source-accurate patches.
- **Exit:** connected repos receiving merge-ready PRs; expansion gated by applied/merge rate.

*Later:* CMS adapters (WordPress/Shopify/headless), autonomous apply, additional capability domains — all on the same engine.

---

## 11. Team & Roles (lean)

- **Founder/PM-eng** — design partners, reasoning/eval iteration, roadmap gate.
- **Backend eng** — crawler pool, knowledge graph, data, billing.
- **AI/quality eng** — rules + reasoning prompts + patch correctness + eval harness (the moat work).
- Adapters (repo/CMS) staffed as they enter the roadmap.

Three people ship Phases 1–2.

---

## 12. Open Technical Decisions

| Decision | Options | Leaning |
|---|---|---|
| Crawl rendering | raw fetch vs. headless Chromium | Playwright (handles SPA/CSR → true universality) |
| Regression trigger | scheduled crawl vs. preview-URL vs. CI ping | scheduled/continuous default; preview-URL premium |
| Patch targeting without source | diff against rendered HTML vs. require source | rendered-HTML patch MVP; source-accurate via adapters later |
| Ownership verification | DNS vs. meta-tag vs. file | support all three |
| Billing rail | Stripe vs. marketplace | Stripe, per property |

---

## 13. Definition of Done (MVP)

Anyone can point the platform at **any website on any stack** and, within minutes, get an accurate, prioritized list of technical-SEO issues — each with what's wrong, why it matters, expected impact, a confidence score, and an **exact fix delivered as a copy-paste snippet or a unified diff** — with continuous monitoring that flags regressions the moment they go live, at >80% gross margin. Repository PRs, CMS updates, and autonomous apply are then added as execution adapters **without changing the reasoning engine.**
