# Phase 0 — Engineering Foundations

> **One-liner:** The groundwork that makes every later phase safe to build: automated quality gates (lint, typecheck, tests), the **golden-set eval harness that enforces the ≥95% precision rule**, validated configuration, structured logging, and reproducible container/dev infrastructure. No product features — this phase exists so Phase 1+ can move fast without breaking correctness.

**Status:** ☐ In progress.

---

## 1. Why Phase 0 Exists

The Phase-1 scaffold proved the pipeline works, but the program's central promise — **"correctness over coverage; no rule ships below 95% precision"** (`00_Overview.md` §5) — was an aspiration with **no mechanism to measure or enforce it**. A detection product whose precision is unmeasured is a demo, not a product: one noisy rule teaches users to ignore findings, and the trust that Phases 3–5 depend on never accumulates.

Phase 0 converts the program's stated standards into **executable gates**.

---

## 2. Objectives & Exit Gate

**Objectives**
1. **Golden-set eval harness** — labelled fixtures across multiple stacks; per-issue precision/recall; **fails the build** below threshold.
2. **CI pipeline** — lint → typecheck → test → eval on every push/PR.
3. **Lint & format** — one fast toolchain, enforced in CI and on commit.
4. **Config management** — schema-validated environment, failing loudly at boot.
5. **Observability skeleton** — structured logging + an error-reporting seam.
6. **Reproducible infra** — Dockerfiles for services + local Postgres/Redis for Phase 2.

**Exit gate**
- `pnpm verify` (lint + typecheck + test + eval) passes locally and in GitHub Actions.
- The eval harness reports per-issue precision/recall and **exits non-zero** if any rule is below 95% precision.
- Config is schema-validated; services log structured JSON.

---

## 3. Scope

**In:** eval harness + golden fixtures, GitHub Actions CI, Biome (lint+format), pre-commit hooks, `@awe/config`, `@awe/logger`, Dockerfiles, docker-compose for local infra, README/docs updates.

**Out:** any new detection rule, product feature, persistence, or UI (those are Phase 1–2). Phase 0 adds **no** customer-visible behavior.

---

## 4. The Golden-Set Eval Harness (the centerpiece)

**Design.** A *case* is a directory of one or more HTML pages plus a label file declaring the issue types each page should produce. Multi-page cases exist so **site-wide rules** (e.g. `duplicate_title`) can be evaluated, since those need several surfaces at once.

```
packages/eval/fixtures/<case>/
  case.json     # { description, pages: [{ file, url, expected: [issueType...] }] }
  *.html        # the page(s)
```

**Method.** For each case: extract surfaces for all pages → run the rule engine over the whole case (so site-wide rules see siblings) → group findings by URL → compare detected vs expected issue types.

- **TP** detected ∧ expected · **FP** detected ∧ ¬expected · **FN** ¬detected ∧ expected
- `precision = TP/(TP+FP)` · `recall = TP/(TP+FN)`

**Why healthy fixtures matter most.** Cases labelled with **no** expected issues (a well-formed Next.js page, a WordPress page, a Shopify product page) are what catch false positives. Precision is meaningless without them, and they simultaneously prove the **universality claim** — the same detector must stay silent on healthy pages regardless of stack.

**Gate.** Per-issue precision must be **≥ 0.95**; the runner prints a table and exits non-zero otherwise. Recall is reported (to expose blind spots) but gated more loosely — a missed issue is far cheaper than a false alarm.

**Tasks**
- ☐ `packages/eval`: fixture loader, harness, metrics, reporter, CLI (`pnpm eval`).
- ☐ Golden fixtures spanning healthy + faulty pages across multiple stacks.
- ☐ Harness self-tests (the harness itself must be correct).
- ☐ Wire into CI as a required check.

---

## 5. CI Pipeline

`.github/workflows/ci.yml` on push + PR: install (frozen lockfile) → **lint** → **typecheck** → **test** → **eval**. Fails on any step. Cached pnpm store for speed.

Composite local equivalent: `pnpm verify`.

---

## 6. Lint & Format

**Biome** — a single fast tool for both linting and formatting (chosen over ESLint+Prettier to avoid plugin/config sprawl in a small team; swappable later). Enforced in CI and via a pre-commit hook (`husky` + `lint-staged`) that checks only staged files.

---

## 7. Configuration (`@awe/config`)

Environment parsed and validated with **zod** at startup; unknown/missing required values fail loudly rather than surfacing as `undefined` at runtime. Single typed `AppConfig` consumed by all services (`NODE_ENV`, `PORT`, `LOG_LEVEL`, and optional `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `SENTRY_DSN` for later phases).

---

## 8. Observability (`@awe/logger`)

**pino** structured JSON logging with a per-service child logger (Fastify already uses pino, so this is consistent). Plus an **error-reporting seam** (`reportError`) that no-ops without a DSN — the hook exists so Phase 2 can drop in Sentry without touching call sites. No heavyweight APM dependency yet.

---

## 9. Infrastructure

- **Dockerfiles** for `apps/api` and `apps/worker` (workspace-aware builds).
- **docker-compose.yml** providing Postgres + Redis locally — the infra Phase 2 needs, available now so persistence work isn't blocked on environment setup.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Fixtures too easy → inflated precision | False confidence | Include realistic multi-stack healthy pages and near-miss cases; grow the set with every real-world miss |
| Eval becomes stale as rules grow | Gate erodes | Every new rule ships with fixtures (definition of done for a rule) |
| Over-strict linting slows delivery | Friction | Recommended rule set only; auto-fix on commit |
| CI slowness | Reduced iteration | pnpm cache; eval is pure-CPU and fast (no network/LLM) |

---

## 11. Work Breakdown

- **Epic A — Eval harness + golden fixtures** (§4)
- **Epic B — CI pipeline** (§5)
- **Epic C — Lint/format + pre-commit** (§6)
- **Epic D — Config + logger** (§7–8)
- **Epic E — Docker + local infra** (§9)

---

## 12. Definition of Done

`pnpm verify` runs lint, typecheck, tests, and the golden-set eval in one command and in GitHub Actions on every push/PR; the eval prints per-issue precision/recall across multi-stack fixtures and **blocks the build below 95% precision**; configuration is schema-validated at boot; services emit structured logs through a shared logger with an error-reporting seam; and Postgres/Redis plus service images are reproducible locally. From here, "a rule ships" has a precise, automated meaning.
