# Phase 3 — Repository Integration & Framework Adapters

> **One-liner:** Add the **Repo PR/MR** rail: connect a GitHub/GitLab repository, map a flagged URL back to the source that renders it, generate a source-accurate fix through a **framework adapter**, validate it in a **sandbox build gate**, and open a merge-ready pull request — driven by the same `RemediationInstruction` produced since Phase 1.

**Status:** ☐ Not started. Depends on Phase 2 persistence, reasoning, and outcome tracking.

---

## 1. Objectives & Exit Gate

**Objectives**
1. **Repo connection:** GitHub App (and GitLab) install → least-privilege access to selected repos.
2. **URL → source mapping:** determine which file/component renders a given route.
3. **Framework adapters:** translate a `RemediationInstruction` into an idiomatic source edit (Next.js and static-HTML first).
4. **Sandbox build gate:** apply the edit, install, build, and re-extract the surface — never surface a fix that fails the build or doesn't resolve the issue.
5. **PR/MR generation:** open a reviewable pull/merge request with explanation, validated by the gate.

**Exit gate**
- Connected repos receive **merge-ready PRs** for supported issue types.
- **Merge-rate-without-edits ≥ target** (e.g. 70%) on design-partner repos.
- Zero build-breaking PRs reach a customer (gate is enforced).

---

## 2. Scope

**In:** GitHub/GitLab connection & webhooks, repo scanner, URL→source mapping, `FrameworkAdapter` interface + Next.js (App + Pages Router) and static-HTML adapters, `repoPrAdapter` (`policy: "repo_pr"`), sandbox build gate (ephemeral Docker), PR/MR creation + status, pre-deploy (preview-URL) detection as a premium capability.

**Out:** CMS write-back (P4), autonomous deploy (P5), non-Next.js/static frameworks beyond the first two (Astro/Nuxt/etc. follow the same interface, later).

---

## 3. Architecture

```
GitHub/GitLab App install ──▶ Connection (repo creds, least-privilege)
        │
        ▼
Repo Scanner ──▶ Framework Detection ──▶ Route→Source Map (persisted)
        │
        ▼
Finding + RemediationInstruction (from P1/P2)
        │
        ▼
FrameworkAdapter.applyToSource(instruction, sourceCtx)  → SourcePatch (unified diff on real files)
        │
        ▼
Sandbox Build Gate:  clone → apply → install → build → re-extract surface
        │  (pass?)
        ├─ fail ─▶ discard fix, keep read-only finding
        └─ pass ─▶ repoPrAdapter.render(...)  → open PR/MR (explanation + diff)
        │
        ▼
Outcome Tracker: merged_unedited | merged_edited | dismissed  → merge-rate
```

**New packages/services**
- `@awe/vcs` — GitHub/GitLab clients, App auth, PR/MR creation.
- `@awe/repo` — repo scanner, framework detection, route→source mapping.
- `@awe/adapters` — `FrameworkAdapter` interface + `nextjs` and `static-html` implementations.
- `@awe/sandbox` — ephemeral Docker build/validate runner.
- `@awe/remediation` — add `repoPrAdapter`.

---

## 4. Repository Connection (least privilege)

- **GitHub App** with permissions: Contents `read+write`, Pull requests `read+write`, Metadata `read`, Checks `write`. No Actions/admin/secrets scopes. GitLab equivalent via project access token / OAuth app.
- Install flow → `Connection` row (kind `github`/`gitlab`, installation id, selected repos, short-lived token exchange). Credentials in secrets manager.
- Webhooks: `pull_request`, `push` (for the premium pre-deploy path), `installation` (suspend/revoke).

**Tasks**
- ☐ GitHub App registration + OAuth/installation flow + token exchange.
- ☐ GitLab connection.
- ☐ `Connection` persistence + revocation handling.

---

## 5. Repo Scanner, Framework Detection & Route→Source Mapping

- **Framework detection:** inspect `package.json`, config files (`next.config.*`), directory conventions (`app/`, `pages/`, `public/`) to classify the repo.
- **Route→source mapping:** the hard, defensible step. For Next.js: map a URL/route to the file exporting its `metadata`/`generateMetadata` or `<head>` usage; for static HTML: map URL path to the `.html` file. Persist the map; refresh on `push`.
- Handle dynamic metadata (`generateMetadata` reading a CMS) by marking fields `"dynamic"` and preferring the **rendered** surface (from preview URL) for those.

**Tasks**
- ☐ Framework detector (Next.js App/Pages, static; extensible).
- ☐ Route→source mapper per adapter; persistence + refresh.
- ☐ Monorepo/workspace handling (single app first; note limitation).

---

## 6. FrameworkAdapter Interface (the source-accurate seam)

```ts
// @awe/adapters
interface SourceContext {
  repoRoot: string;            // checked-out working tree
  route: string;
  files: string[];            // candidate source files for this route
}
interface SourcePatch { diffs: { path: string; unifiedDiff: string }[]; }

interface FrameworkAdapter {
  readonly framework: string;                 // "nextjs" | "static-html" | ...
  detect(repoRoot: string): Promise<boolean>;
  mapRoute(route: string, repoRoot: string): Promise<string[]>;
  applyToSource(instruction: RemediationInstruction, ctx: SourceContext): Promise<SourcePatch | null>;
}
```

- **Next.js adapter:** edits the `metadata` export / `generateMetadata` return / `app/robots.ts` / `app/sitemap.ts` idiomatically (e.g., add `alternates.canonical`, set `title`, add JSON-LD via a script component).
- **Static-HTML adapter:** the simplest — insert/replace in `<head>` of the mapped file (reuses `buildHeadInsertPatch` logic on the real file).
- Adapters return `null` when they cannot safely express the fix in source → the platform falls back to the Patch/Recommendation rails (universal safety net).

**Tasks**
- ☐ `FrameworkAdapter` interface + registry.
- ☐ Next.js adapter (App Router first, Pages Router next) + fixtures.
- ☐ Static-HTML adapter + fixtures.

---

## 7. Sandbox Build Gate (the trust guarantee)

**Hard rule:** never surface a fix that fails the build or fails to resolve the issue.

- Ephemeral **Docker** container (or Fly Machine): shallow-clone head, apply `SourcePatch`, detect package manager, install, run the build (`next build` / site build), then **re-extract the surface** from the build output and confirm the target issue is resolved with **no new findings**.
- **Isolation:** no repo secrets in the build env; egress restricted to package registries; CPU/mem/time caps; container destroyed after each run; treat customer code + install scripts as untrusted.
- **Caching:** cache `node_modules`/build cache keyed by lockfile hash to control time and cost.

**Tasks**
- ☐ Sandbox runner (`@awe/sandbox`): clone/apply/install/build/verify.
- ☐ Isolation + resource limits + registry-only egress.
- ☐ Build-cache keyed by lockfile; timeout/kill semantics.
- ☐ Re-extraction + "resolved & no-new-findings" assertion.

---

## 8. repoPrAdapter (Policy 3)

```ts
// @awe/remediation
export const repoPrAdapter: RemediationAdapter = {
  policy: "repo_pr",
  supports: (ctx) => Boolean(ctx.connections?.repo),
  render: async (instruction, ctx) => { /* framework adapter → sandbox gate → open PR */ },
};
```

- Branch naming, commit message, PR title/body (issue, why, impact, confidence, the validated diff, "build passed ✅").
- One PR per finding by default; optional batched PR per property scan (behind a setting).
- PR carries a machine-readable trailer linking back to `RemediationOutput.id` for outcome tracking.

**Tasks**
- ☐ `repoPrAdapter` wiring adapter → gate → `@awe/vcs` PR/MR creation.
- ☐ PR body template + trailer; batching setting.

---

## 9. Pre-Deploy Detection (premium capability)

Where a per-PR **preview URL** exists (Vercel/Netlify comment on the PR), crawl base vs head preview and run `diffSurfaces` → comment the *would-be* regressions on the PR before merge. This is the only place "prevent before it ships" is possible; offer it as a premium tier for stacks that support previews.

**Tasks**
- ☐ Detect preview URLs from PR events/comments.
- ☐ Base-vs-head rendered diff → PR check + comment.

---

## 10. Outcome Tracking (merge-rate)

- Listen for `pull_request.closed(merged)` + branch commits; resolve each PR's `Outcome` to `merged_unedited | merged_edited | dismissed | superseded` (compare merged diff to proposed diff for "unedited").
- **Merge-rate-without-edits** is the primary Phase-3 gate and the eval signal for adapter/prompt iteration.

---

## 11. Security & Privacy

- Least-privilege App scopes (§4); short-lived tokens; revoke on uninstall.
- Sandbox isolation (§7) is the main new attack surface — no secrets, egress-restricted, ephemeral.
- Never persist repo source beyond a job's lifetime; store only diffs/metadata needed for the PR + outcome.
- Enterprise readiness groundwork: audit log of PRs opened, self-hosted-runner design note (full in P5).

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A PR breaks the build | Uninstall + bad word-of-mouth | Sandbox build gate is mandatory; fail-closed to read-only finding |
| Wrong route→source mapping | Fix in the wrong place | Persisted, refreshed maps; adapter returns `null` when unsure → universal fallback |
| Dynamic metadata not expressible in source | Under-coverage | Mark `"dynamic"`, prefer rendered surface, fall back to Patch rail |
| Sandbox abused by malicious repo | Security incident | No secrets, restricted egress, resource caps, ephemeral, untrusted-by-default |
| Low merge-rate | Product thesis fails | Gate expansion on merge-rate; iterate adapters/prompts before scaling frameworks |

---

## 13. Work Breakdown

- **Epic A — VCS connection** (GitHub App, GitLab) (§4)
- **Epic B — Repo scanner + framework detection + route→source map** (§5)
- **Epic C — FrameworkAdapter interface + Next.js + static-HTML** (§6)
- **Epic D — Sandbox build gate** (§7)
- **Epic E — repoPrAdapter + PR/MR generation** (§8)
- **Epic F — Pre-deploy preview detection (premium)** (§9)
- **Epic G — Merge-rate outcome tracking** (§10)
- **Epic H — Dashboard: repo affordances** — connect-repo UI, "Open PR" action + PR/merge status, merge-rate view (`Customer_Dashboard.md` §4 P3).
- **Epic I — Superadmin: repo ops** — view/revoke repo connections, requeue PR/sandbox jobs, per-org premium-preview flag (`Superadmin_Console.md` §9 P3).

---

## 14. Definition of Done

A design partner connects a GitHub/GitLab repo; for supported issue types the platform maps the route to source, generates an idiomatic fix through a framework adapter, **proves it builds and resolves the issue in an isolated sandbox**, and opens a merge-ready PR with a clear explanation; merged PRs are tracked into a **merge-rate-without-edits** that clears the target; and **no build-breaking PR ever reaches a customer**. The Recommendation and Patch rails remain the universal fallback whenever an adapter or the gate declines — so coverage never regresses for unsupported stacks.
