# AI Website Engineer

The universal AI that understands any website, reasons about technical-SEO issues, and delivers fixes through a **pluggable remediation layer**. Detection reads *rendered output*, so it works on any stack; remediation starts with two universal rails (Recommendation + AI Patch) and grows richer over time — without ever changing the reasoning engine.

See [`docs/`](docs/) for the vision (`AI_Website_Engineer_Vision_v5.md`) and [`docs/implementation/`](docs/implementation/) for the phased program.

## Architecture

```
rendered HTML ──▶ extract surface ──▶ detect findings ──▶ reason ──▶ remediate
                 (@awe/extractor)     (@awe/rules)      (@awe/reasoning)  (@awe/remediation)
                                                                          ├─ recommendation (universal)
                                                                          └─ patch / unified diff (universal)
```

The core contract is `RemediationInstruction` (in `@awe/core`): the reasoning engine emits it and **never decides how a fix is applied**. Execution adapters turn it into a snippet, a diff, a PR, a CMS write, etc.

## Packages

| Package | Responsibility |
| --- | --- |
| `@awe/core` | Shared contracts: `SeoSurface`, `Finding`, `RemediationInstruction`, `RemediationAdapter` |
| `@awe/extractor` | Rendered HTML → `SeoSurface` (universal, cheerio) |
| `@awe/rules` | Deterministic detection rules + engine |
| `@awe/reasoning` | `Finding` → `RemediationInstruction` (deterministic today; LLM-pluggable) |
| `@awe/remediation` | Execution rails: `recommendation`, `patch` |
| `@awe/pipeline` | Composition root: `runScan(html, url)` |
| `@awe/crawler` | Headless-Chromium renderer (+ `fetchCrawl` fallback) |
| `@awe/eval` | Golden-set eval harness + precision gate |
| `@awe/config` | Schema-validated environment (zod) |
| `@awe/logger` | Structured logging (pino) + error-reporting seam |
| `apps/api` | Fastify service exposing `POST /scan` |
| `apps/worker` | BullMQ worker (idle unless `REDIS_URL` set) |

## Quick start

```bash
pnpm install
pnpm verify         # lint + typecheck + test + eval (the full gate)

# Try the pipeline on the sample broken page:
pnpm scan examples/broken-page.html
# ...or any live URL (server-rendered/static):
pnpm scan https://example.com

# Run the API and scan via HTTP:
pnpm dev:api
# curl -s localhost:3000/scan -H 'content-type: application/json' \
#   -d "{\"url\":\"https://ex.com/p\",\"html\":\"<html><head></head><body></body></html>\"}"
```

## Quality gates

| Command | What it enforces |
| --- | --- |
| `pnpm lint` / `pnpm lint:fix` | Biome lint + format |
| `pnpm typecheck` | `tsc` across the workspace |
| `pnpm test` | Unit + end-to-end pipeline tests |
| `pnpm eval` | **Golden-set precision gate** — fails below 95% precision per rule |
| `pnpm verify` | All of the above, in order (mirrors CI) |

The **golden-set eval** (`packages/eval`) is the program's correctness gate. Fixtures live in
`packages/eval/fixtures/<case>/` as HTML plus a `case.json` labelling the issue types each page
should produce. Multi-page cases let site-wide rules (e.g. `duplicate_title`) see sibling pages, and
`healthy-*` cases across different stacks (Next.js, WordPress, Shopify) are what catch false
positives. **Every new detection rule ships with fixtures.**

CI (`.github/workflows/ci.yml`) runs the same chain on every push and PR.

## Docker

Copy the env template and fill in what you need — every value may be left empty,
in which case `packages/config`'s schema defaults apply:

```bash
cp .env.example .env      # or edit the .env already present (gitignored)
```

| Command | What it does |
| --- | --- |
| `pnpm infra:up` | Postgres + Redis only — use with `pnpm dev:api` on the host |
| `pnpm stack:up` | Builds and starts the whole stack (postgres, redis, api, worker) |
| `pnpm stack:logs` | Tails the api and worker logs |
| `pnpm stack:down` | Stops everything and removes volumes |
| `pnpm verify:docker` | Runs the full gate (lint → typecheck → test → eval) **inside the image** |

Then:

```bash
curl localhost:3000/healthz
curl -s localhost:3000/site-scan -H 'content-type: application/json' \
  -d '{"url":"https://example.com","maxPages":5}'
```

Notes on the image (`Dockerfile`): it is Debian `slim`, not Alpine, because
esbuild (via tsx/vitest) ships glibc binaries and Playwright supports Debian but
not musl. Dev dependencies are installed deliberately — the services execute
TypeScript through `tsx` at runtime. `HUSKY=0` keeps the `prepare` hook from
failing in an image with no git. Services run as a non-root user.

> ⚠️ **Unverified:** the Dockerfile and compose file have not been built or run —
> Docker is not installed on the machine they were authored on. Structure,
> build inputs, the healthcheck command, and both start scripts were each
> validated outside Docker, but expect to debug the first `docker compose build`.

## Status

- **Phase 0 — Engineering foundations:** complete (CI, lint/format, eval harness + gate, config, logging, containers).
- **Phase 1 — Universal detection + deterministic remediation:** core pipeline built and verified; remaining scope (full issue catalog, ownership verification, report UI) tracked in `docs/implementation/`.

## Notes

- The crawler uses `playwright-core`; provision a browser (`npx playwright install chromium`) to use `crawl()`. `fetchCrawl()` needs no browser.
- The LLM reasoner is not wired yet; the deterministic path needs no `ANTHROPIC_API_KEY`.
- Fixture HTML and `examples/` are excluded from linting on purpose — they are test data and must stay byte-exact.
