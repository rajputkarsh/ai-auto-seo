# Phase 1 — Universal Detection & Deterministic Remediation (MVP)

> **One-liner:** Point the platform at any website, on any stack, and get an accurate, prioritized list of technical-SEO issues — each with what's wrong, why it matters, expected impact, a confidence score, and an exact fix delivered as a copy-paste snippet (Recommendation rail) or a unified diff (Patch rail). No infrastructure, no LLM key, no framework adapters.

**Status:** Core pipeline **built & verified** (19 tests, clean typecheck, CLI + API working end-to-end). Remaining Phase-1 scope (full issue catalog, ownership verification, minimal UI, hosting) is specified below and marked ☐.

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

**Remaining ☐**
- ☐ Site-wide fetches: `robots.txt`, `sitemap.xml` presence/among-URL counts (feeds robots/sitemap rules).
- ☐ Resolve relative canonicals/OG URLs against the page URL before evaluation.

---

## 6. Issue Catalog

**Shipped (deterministic rules, tested)**

| Rule | Issues | Severity |
|---|---|---|
| `canonicalRule` | `missing_canonical`, `malformed_canonical` | high / medium |
| `titleRule` | `missing_title`, `duplicate_title` | high / medium |
| `metaDescriptionRule` | `missing_meta_description` | medium |

**Remaining Phase-1 rules ☐** (each needs golden fixtures + ≥95% precision before shipping)

| Rule | Issues | Signal |
|---|---|---|
| ☐ `robotsRule` | `noindex_unexpected` | `robots.index === false` where indexable expected |
| ☐ `sitemapRobotsRule` | robots.txt blocks / sitemap missing | site-wide fetch |
| ☐ `structuredDataRule` | `missing_structured_data`, `invalid_structured_data` | JSON-LD absent / `valid=false` |
| ☐ `headingRule` | `missing_h1`, `multiple_h1` | `h1Count` 0 or >1 |
| ☐ `socialRule` | missing OG/Twitter | empty `openGraph`/`twitter` |
| ☐ `statusRule` | broken links / bad status | non-2xx, redirect chains (needs link crawl) |

The `IssueType` union in `@awe/core` already enumerates these; adding a rule = new `Rule` + fixtures + register in `defaultRules`.

---

## 7. Reasoning (deterministic)

- `deterministicReasoner` maps each `IssueType` to: `whyItMatters` copy, a `confidence` prior, `targetSurfaceChange`, and `canonicalFix` (exact `<head>` HTML + `diffHint`).
- Title suggestions are derived from the URL slug as a starting point.
- **Extensibility:** the `Reasoner` interface is the swap point for the Phase-2 LLM reasoner; no downstream code changes when it's replaced.

**Remaining ☐**
- ☐ Confidence priors + copy for the new issue types added in §6.

---

## 8. Remediation Rails

**Policy 1 — Recommendation** (`recommendationAdapter`)
- `supports()` = always true (universal). Renders a card: issue, what/why, impact, confidence %, suggested fix.

**Policy 2 — AI Patch** (`patchAdapter`)
- `supports(ctx)` = `ctx.html` present. Inserts the fix before `</head>` (indentation-preserving) and returns a standard unified diff via `buildHeadInsertPatch` (jsdiff). Robust to single-line and multi-line HTML.

**Remaining ☐**
- ☐ Multi-fix batching: emit one combined diff per page when several head-insertions apply.
- ☐ Non-head fixes (e.g., fixing an existing malformed tag rather than inserting) — replace-in-place diffs.

---

## 9. Interfaces: CLI & API

**CLI** — `pnpm scan <url | file.html>` runs `runScan` and prints, per issue, the recommendation and (when patchable) the diff. Zero external services.

**API** — `apps/api`:
- `GET /healthz` → `{ ok: true }`
- `POST /scan { url, html }` → `ScanResult` (`surface` + `items[]` with `finding`, `instruction`, `recommendation`, `patch?`).

**Remaining ☐**
- ☐ `POST /scan { url }` variant that crawls server-side via `@awe/crawler` (bridges to Phase 2).
- ☐ Request validation (zod) + structured error shape + rate limiting.

---

## 10. Property Registration & Ownership Verification ☐

Before scheduled crawling (Phase 2) we must verify the requester owns the property. Build the primitive now:
- ☐ `Property` concept (URL/domain) — minimal in P1, persisted in P2.
- ☐ Ownership proof via one of: DNS TXT record, `<meta>` tag, or a well-known file. Store proof + verified timestamp.
- ☐ On-demand scans (single URL) require no verification; scheduled/continuous crawls do.

---

## 11. Testing & Eval (the precision gate)

**Unit tests (present):** extractor (4), rules (6), reasoning (3), remediation (4), pipeline e2e (2) — 19 total, all green.

**Golden-set eval harness ☐** (the gate for every rule)
- ☐ A `packages/eval` (or `test/golden`) corpus of 15–20 real sites across stacks (WordPress, Shopify, Next.js, static HTML, .NET), each with labeled expected findings and seeded regressions.
- ☐ Runner computes **precision & recall per rule**; fails CI if any shipped rule < 95% precision.
- ☐ Snapshot the `SeoSurface` per fixture so extractor changes are reviewable diffs.
- ☐ Wire into GitHub Actions as a required check (a regression in our detector fails our build).

---

## 12. Observability & Cost

- Phase-1 delivery cost is ~zero (no LLM on the deterministic path).
- ☐ Add per-scan timing + issue counts to logs; a minimal metrics endpoint (`/metrics`) exposing scans, findings, rule hit-rates. (Full cost/margin dashboard lands in Phase 2 when LLM + infra enter.)

---

## 13. Hosting & CI ☐

- ☐ Dockerfile for `apps/api`; deploy to Fly.io/Railway.
- ☐ GitHub Actions: `pnpm install`, `pnpm typecheck`, `pnpm test`, golden-set eval — required on PR; deploy on merge to `main`.

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

**Epic A — Complete the issue catalog**
- ☐ Implement `robotsRule`, `structuredDataRule`, `headingRule`, `socialRule` (+ fixtures).
- ☐ Site-wide `robots.txt`/`sitemap.xml` fetch + `sitemapRobotsRule`.
- ☐ Reasoner priors/copy for the new issues.

**Epic B — Eval harness**
- ☐ Golden corpus + per-rule precision/recall runner + CI gate.

**Epic C — Crawl bridge & API hardening**
- ☐ `POST /scan { url }` server-side crawl; request validation; error shape.

**Epic D — Ownership & registration primitive**
- ☐ Property + ownership verification (DNS/meta/file).

**Epic E — Ship it**
- ☐ Dockerfile + CI + deploy; minimal results view (optional).

---

## 16. Definition of Done

Anyone can point the platform (CLI, API, or crawl-by-URL) at **any website on any stack** and within minutes receive an accurate, prioritized list of technical-SEO issues — each with what/why/impact/confidence and an exact fix as a snippet and (where a `<head>` exists) a unified diff — with every shipped rule proven ≥95% precise by a CI-enforced golden-set eval. The `RemediationInstruction` seam and `Reasoner`/`RemediationAdapter` interfaces are in place so Phase 2 (LLM reasoner, persistence, monitoring, billing) and Phase 3 (repo PRs) attach without reworking the core.
