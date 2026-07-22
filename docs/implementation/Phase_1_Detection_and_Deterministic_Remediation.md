# Phase 1 — Universal Detection & Deterministic Remediation (MVP)

> **One-liner:** Point the platform at any website, on any stack, and get an accurate, prioritized list of technical-SEO issues — each with what's wrong, why it matters, expected impact, a confidence score, and an exact fix delivered as a copy-paste snippet (Recommendation rail) or a unified diff (Patch rail). No infrastructure, no LLM key, no framework adapters.

**Status:** **Substantially complete.** Pipeline, the issue catalog (9 issue types across 6 rules), deterministic reasoning, both remediation rails, prioritization, CLI, and a hardened API are built and verified — 44 tests green, 16 golden cases / 18 pages at **100% precision & recall**, CI-enforced. Remaining: ownership verification (Epic D), site-wide `robots.txt`/`sitemap.xml` rules, and deploy (Epic E), all marked ☐ below.

---

## 1. Objectives & Exit Gate

**Objectives**
1. Universal, framework-blind detection from rendered HTML.
2. Deterministic reasoning: every finding → a structured `RemediationInstruction`.
3. Two universal remediation rails: Recommendation and AI Patch (unified diff).
4. An eval harness that proves ≥95% precision per rule on a golden set.
5. Two ways to run it: a CLI (`pnpm scan`) and an HTTP API (`POST /scan`).

**Exit gate (all must hold)**
- Point at any URL/HTML on any stack → accurate findings + explanations.
- ≥95% precision per shipped rule on the golden set; CI enforces it.
- Recommendation rail works on 100% of inputs; Patch rail works whenever HTML has a `<head>`.
- Time-to-first-finding < a few minutes for a first-time user.

---

## 2. Scope

**In scope**
- Rendered-HTML surface extraction (`@awe/extractor`).
- Deterministic rule engine + the Phase-1 issue catalog (§6).
- Deterministic reasoner (`@awe/reasoning`) — no LLM.
- Recommendation + Patch adapters (`@awe/remediation`).
- Composition root (`@awe/pipeline`), CLI (`scripts/scan.ts`), API (`apps/api`).
- Golden-set eval harness + CI wiring.
- Property registration + **ownership verification** (☐).
- A minimal results UI / report (☐, optional for MVP; API + CLI suffice to validate).

**Out of scope (later phases)**
- Persistence / knowledge graph (P2), continuous crawl & regression deltas (P2), billing (P2), LLM reasoner (P2), repo PRs (P3), CMS write-back (P4), autonomous apply (P5).

---

## 3. Architecture (as built)

```
HTML (file | URL | request body)
        │
        ▼
extractSurface(html, url)            @awe/extractor   → SeoSurface
        │
        ▼
evaluate([surface])                  @awe/rules       → Finding[]
        │
        ▼
deterministicReasoner.reason(f, s)   @awe/reasoning   → RemediationInstruction
        │
        ├─ recommendationAdapter.render(...)  @awe/remediation (Policy 1, universal)
        └─ patchAdapter.render(...)           @awe/remediation (Policy 2, needs html)
        │
        ▼
runScan(html, url)                   @awe/pipeline    → ScanResult
        │
   ┌────┴────┐
   ▼         ▼
 CLI       apps/api  POST /scan
```

**Package responsibilities**

| Package | Responsibility | Key export |
|---|---|---|
| `@awe/core` | Contracts | `SeoSurface`, `Finding`, `RemediationInstruction`, `RemediationAdapter`, `SiteContext` |
| `@awe/extractor` | Rendered HTML → surface (cheerio) | `extractSurface(html, url, status?)` |
| `@awe/rules` | Detection engine + rules | `evaluate(surfaces, opts?)`, `defaultRules`, `Rule` |
| `@awe/reasoning` | Finding → instruction | `deterministicReasoner`, `Reasoner` |
| `@awe/remediation` | Execution rails | `recommendationAdapter`, `patchAdapter`, `buildHeadInsertPatch` |
| `@awe/pipeline` | Composition | `runScan(html, url, reasoner?)` |
| `@awe/crawler` | Rendering | `crawl(url)` (Playwright), `fetchCrawl(url)` |
| `apps/api` | HTTP surface | Fastify `POST /scan`, `GET /healthz` |

---

## 4. Core Contracts (already implemented)

```ts
// @awe/core
interface SeoSurface {
  url: string; route?: string; status?: number;
  title?: string; description?: string; canonical?: string | null;
  robots?: { index: boolean; follow: boolean };
  openGraph?: Record<string,string>; twitter?: Record<string,string>;
  jsonLd?: { type: string; valid: boolean; errors?: string[] }[];
  h1Count?: number; hreflang?: { lang: string; href: string }[];
}

interface RemediationInstruction {
  finding: Finding;
  whatIsWrong: string; whyItMatters: string; expectedImpact: string;
  confidence: number;                       // 0..1
  targetSurfaceChange: Partial<SeoSurface>; // desired end-state
  canonicalFix: { html?: string; diffHint?: string };
}

interface RemediationAdapter {
  readonly policy: RemediationPolicy;
  supports(ctx: SiteContext): boolean;
  render(instruction: RemediationInstruction, ctx: SiteContext): Promise<RemediationOutput>;
}
```

The reasoner produces the instruction; **adapters never feed back into reasoning**. This is the seam every later rail plugs into.

---

## 5. The Extractor (universal detection input)

- Loads rendered HTML with cheerio and reads output only — no framework knowledge.
- Extracts: title, meta description, canonical (`null` when absent), robots (`index`/`follow`, handling `noindex`/`nofollow`/`none`), Open Graph, Twitter, JSON-LD (with validity), `h1Count`, hreflang.
- Robust to malformed input: invalid JSON-LD is flagged, never thrown.
- **Rendering source:** `@awe/crawler.crawl()` (Playwright, handles CSR/SPA) or `fetchCrawl()` (SSR/static). Phase 1 accepts HTML directly; the crawler is exercised fully in Phase 2's continuous pipeline.

**Done ✅**
- ✅ **Relative URLs resolved against the page URL before evaluation.** `resolveUrl()` turns `/pricing` into an absolute URL, so relative canonicals — which are valid HTML that search engines resolve — are no longer reported as malformed. This closed the false positive listed in §14 and changed `malformed_canonical` to mean "unusable after resolution" (e.g. a `javascript:` href).

**Remaining ☐**
- ☐ Site-wide fetches: `robots.txt`, `sitemap.xml` presence/URL counts (feeds the sitemap/robots rules).
- ☐ Resolve OG/Twitter URLs (lower value than canonical; no rule consumes them yet).

---

## 6. Issue Catalog

**Shipped ✅** (deterministic, unit-tested, each with golden fixtures at 100% precision)

| Rule | Issues | Severity |
|---|---|---|
| `titleRule` | `missing_title`, `duplicate_title` | high / medium |
| `metaDescriptionRule` | `missing_meta_description` | medium |
| `canonicalRule` | `missing_canonical`, `malformed_canonical` | high / medium |
| `robotsRule` | `noindex_unexpected` | high |
| `structuredDataRule` | `invalid_structured_data` | medium |
| `headingRule` | `missing_h1`, `multiple_h1` | medium / low |

**Deliberate exclusions** — precision-first calls, not oversights. Each would fire on a large share of healthy pages, and a noisy rule teaches users to ignore findings:

| Not shipped | Why |
|---|---|
| `missing_structured_data` | JSON-LD is optional and page-type dependent; "no JSON-LD" fires on most healthy pages. Only *broken* JSON-LD is an unambiguous defect. |
| `socialRule` (missing OG/Twitter) | Affects social sharing, not search ranking; absent on a large share of otherwise-healthy pages. Low severity, high fire rate. |

**Remaining Phase-1 rules ☐**

| Rule | Issues | Blocked on |
|---|---|---|
| ☐ `sitemapRobotsRule` | robots.txt blocks / sitemap missing | site-wide fetch (§5) |
| ☐ `statusRule` | broken links / bad status | link crawl (arrives with the Phase-2 crawler pool) |

Adding a rule = new `Rule` + golden fixtures + register in `defaultRules`.

---

## 7. Reasoning (deterministic)

- `deterministicReasoner` maps each `IssueType` to: `whyItMatters` copy, a `confidence` prior, `targetSurfaceChange`, and `canonicalFix` (exact `<head>` HTML + `diffHint`).
- Title suggestions are derived from the URL slug as a starting point.
- **Extensibility:** the `Reasoner` interface is the swap point for the Phase-2 LLM reasoner; no downstream code changes when it's replaced.

**Done ✅**
- ✅ Confidence priors + `whyItMatters` copy for all 9 shipped issue types. Priors encode certainty: `missing_title` 0.99 down to `multiple_h1` 0.60 (legal under HTML5 sectioning, so advisory).
- ✅ **Head-only invariant.** The patch rail inserts `canonicalFix.html` before `</head>`, so the reasoner supplies `html` *only* for genuine head insertions. Body-level fixes (`missing_h1`, `multiple_h1`) and replacements (`noindex_unexpected`, `invalid_structured_data`) ship `diffHint` guidance instead — inserting a second robots meta would not lift a `noindex` (engines honour the most restrictive), and an `<h1>` in `<head>` would be invalid. Locked by tests in `packages/pipeline/src/prioritize.test.ts`.

---

## 8. Remediation Rails

**Policy 1 — Recommendation** (`recommendationAdapter`)
- `supports()` = always true (universal). Renders a card: issue, what/why, impact, confidence %, suggested fix.

**Policy 2 — AI Patch** (`patchAdapter`)
- `supports(ctx)` = `ctx.html` present. Inserts the fix before `</head>` (indentation-preserving) and returns a standard unified diff via `buildHeadInsertPatch` (jsdiff). Robust to single-line and multi-line HTML.

**Remaining ☐**
- ☐ Multi-fix batching: emit one combined diff per page when several head-insertions apply.
- ☐ **Replace-in-place diffs** — needed to auto-fix `noindex_unexpected`, `malformed_canonical`, and `invalid_structured_data`, which currently ship as guidance only (see §7). This is the single biggest remaining lever on patch coverage.

---

## 9. Interfaces: CLI & API

**CLI** — `pnpm scan <url | file.html>` runs `runScan` and prints, per issue, the recommendation and (when patchable) the diff. Zero external services.

**API** — `apps/api`:
- `GET /healthz` → `{ ok: true }`
- `POST /scan { url, html }` → `ScanResult` (`surface` + `items[]` with `finding`, `instruction`, `recommendation`, `patch?`).

**Done ✅**
- ✅ `POST /scan { url }` (no `html`) fetches server-side via `@awe/crawler.fetchCrawl` — verified end-to-end against a live site.
- ✅ zod request validation + structured error shape `{ error: { code, message, details? } }` (`invalid_request` → 400, `fetch_failed` → 502).
- ✅ `GET /metrics` with in-process counters (scans, findings, per-issue-type) + per-scan timing in logs.
- ✅ Findings **prioritized** high → medium → low, tie-broken by issue type for stable output.

**Remaining ☐**
- ☐ Rate limiting + auth (needed before public exposure).
- ☐ Playwright-rendered `POST /scan { url }` for client-rendered pages (Phase-2 crawler pool; `fetchCrawl` covers SSR/static today).

---

## 10. Property Registration & Ownership Verification ☐

Before scheduled crawling (Phase 2) we must verify the requester owns the property. Build the primitive now:
- ☐ `Property` concept (URL/domain) — minimal in P1, persisted in P2.
- ☐ Ownership proof via one of: DNS TXT record, `<meta>` tag, or a well-known file. Store proof + verified timestamp.
- ☐ On-demand scans (single URL) require no verification; scheduled/continuous crawls do.

---

## 11. Testing & Eval (the precision gate)

**Unit tests ✅:** extractor (4), rules engine (6), rules catalog (11), reasoning (3), remediation (4), pipeline e2e (2), prioritization + patch safety (4), config (4), eval harness (6) — **44 total, all green.**

**Golden-set eval harness ✅** (built in Phase 0; the gate for every rule)
- ✅ `packages/eval` corpus: **16 cases / 18 pages** across Next.js, WordPress, Shopify and plain HTML, each labelled with expected issue types.
- ✅ Runner computes **precision & recall per issue type**; exits non-zero below 95% precision. Currently **100% / 100%** with zero false positives.
- ✅ Wired into GitHub Actions as a required check; `pnpm verify` runs it locally.
- ✅ Gate proven non-vacuous: injecting a false positive drops precision to 50% and fails the build.

**Remaining ☐**
- ☐ Snapshot the `SeoSurface` per fixture so extractor changes show up as reviewable diffs.
- ☐ Grow the corpus toward 15–20 *real* sites (current fixtures are realistic but hand-authored).

---

## 12. Observability & Cost

- Phase-1 delivery cost is ~zero (no LLM on the deterministic path).
- ✅ Per-scan timing + finding counts in structured logs; `GET /metrics` exposes scans, findings, and per-issue-type hit rates. Counters are in-process and reset on restart — persistent metrics and the cost/margin dashboard land in Phase 2 with the datastore.

---

## 13. Hosting & CI ☐

- ✅ Dockerfiles for `apps/api` and `apps/worker` (built in Phase 0; **unvalidated — Docker not available on the dev machine**).
- ✅ GitHub Actions running lint → typecheck → test → golden-set eval on push/PR.
- ☐ Actually deploy to Fly.io/Railway; add deploy-on-merge to `main`.

---

## 14. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A rule over-fires (false positives) | Erodes trust immediately | ≥95% precision gate + true-negative fixtures; ship rules one at a time |
| Static extraction misses JS-rendered metadata | Under-detection on SPAs | Use Playwright rendering (`crawl`) not raw fetch; validate on CSR fixtures |
| Relative canonicals mis-flagged as malformed | False positives | Resolve relatives against page URL before the rule (§5 remaining) |
| Patch mis-inserts on exotic HTML | Bad diff | jsdiff-based, `<head>`-anchored, indentation-preserving; fixtures cover single/multi-line |

---

## 15. Work Breakdown (remaining Phase-1)

**Epic A — Complete the issue catalog** ✅ (mostly)
- ✅ `robotsRule`, `structuredDataRule`, `headingRule` + golden fixtures.
- ✅ Reasoner priors/copy for the new issues; head-only fix invariant enforced.
- ✅ Relative-URL resolution (removed the malformed-canonical false positive).
- ⊘ `socialRule` deliberately excluded (§6) — noise, not ranking-relevant.
- ☐ Site-wide `robots.txt`/`sitemap.xml` fetch + `sitemapRobotsRule`.

**Epic B — Eval harness** ✅ (delivered in Phase 0)
- ✅ Golden corpus + per-issue precision/recall runner + CI gate, proven non-vacuous.

**Epic C — Crawl bridge & API hardening** ✅
- ✅ `POST /scan { url }` server-side fetch; zod validation; structured errors; `/metrics`; prioritized output.
- ☐ Rate limiting + auth before public exposure.

**Epic D — Ownership & registration primitive** ☐
- ☐ Property + ownership verification (DNS TXT / meta tag / well-known file). **The main remaining Phase-1 gap**, and a prerequisite for Phase 2's scheduled crawling.

**Epic E — Ship it**
- ✅ Dockerfiles + CI.
- ☐ Deploy; minimal results view (optional).

---

## 16. Definition of Done

Anyone can point the platform (CLI, API, or crawl-by-URL) at **any website on any stack** and within minutes receive an accurate, prioritized list of technical-SEO issues — each with what/why/impact/confidence and an exact fix as a snippet and (where a `<head>` exists) a unified diff — with every shipped rule proven ≥95% precise by a CI-enforced golden-set eval. The `RemediationInstruction` seam and `Reasoner`/`RemediationAdapter` interfaces are in place so Phase 2 (LLM reasoner, persistence, monitoring, billing) and Phase 3 (repo PRs) attach without reworking the core.
