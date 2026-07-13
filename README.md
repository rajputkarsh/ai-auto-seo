# AI Website Engineer

The universal AI that understands any website, reasons about technical-SEO issues, and delivers fixes through a **pluggable remediation layer**. Detection reads *rendered output*, so it works on any stack; remediation starts with two universal rails (Recommendation + AI Patch) and grows richer over time — without ever changing the reasoning engine.

See [`docs/`](docs/) for the vision (`AI_Website_Engineer_Vision_v5.md`) and the full implementation plan.

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
| `apps/api` | Fastify service exposing `POST /scan` |
| `apps/worker` | BullMQ worker (idle unless `REDIS_URL` set) |

## Quick start

```bash
pnpm install
pnpm test          # unit + end-to-end pipeline tests
pnpm typecheck     # tsc across the workspace

# Try the pipeline on the sample broken page:
pnpm scan examples/broken-page.html
# ...or any live URL (server-rendered/static):
pnpm scan https://example.com

# Run the API and scan via HTTP:
pnpm dev:api
# curl -s localhost:3000/scan -H 'content-type: application/json' \
#   -d "{\"url\":\"https://ex.com/p\",\"html\":\"<html><head></head><body></body></html>\"}"
```

## Status

MVP scaffold — Phase 1 of the implementation plan: universal detection + reasoning + the Recommendation and Patch rails, all deterministic and running with zero infra. Next: continuous crawl + regression deltas, the LLM-backed reasoner, persistence, and the repo-PR rail.

## Notes

- The crawler uses `playwright-core`; provision a browser (`npx playwright install chromium`) to use `crawl()`. `fetchCrawl()` needs no browser.
- The LLM reasoner is not wired yet; the deterministic path needs no `ANTHROPIC_API_KEY`.
