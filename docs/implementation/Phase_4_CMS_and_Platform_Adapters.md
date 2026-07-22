# Phase 4 — CMS & Platform Adapters

> **One-liner:** Add the **CMS/Platform update** rail: for sites whose content and SEO fields live in a CMS or commerce platform (WordPress, Shopify, and headless CMSs like Contentful/Sanity/Strapi), apply the fix by writing the corrected field through the platform's API — the same `RemediationInstruction`, a non-git execution mechanism. This is how the platform serves the huge, non-developer-native market without breaking the universal model.

**Status:** ☐ Not started. Depends on Phase 2 (persistence, reasoning, outcomes). Independent of Phase 3 — both consume the same instruction and can be sequenced by design-partner mix.

---

## 1. Objectives & Exit Gate

**Objectives**
1. **Platform connections:** OAuth/app-based, least-privilege access to WordPress, Shopify, and 1–2 headless CMSs.
2. **Field mapping:** map a page's SEO surface fields to the CMS's structured content fields (per-platform adapter).
3. **`cmsAdapter` (`policy: "cms"`):** write the corrected field via the platform API, as a **draft/change for review** by default.
4. **Write-back verification:** re-scan the affected URL to confirm the surface changed as intended.

**Exit gate**
- A WordPress (and one other platform) site can be connected and remediated end-to-end via the CMS rail, with changes staged for human approval and verified by re-scan.
- Applied-fix rate on CMS sites tracked and healthy.

---

## 2. Scope

**In:** WordPress (REST API and/or a companion plugin), Shopify (Admin API / theme + metafields), one headless CMS (Contentful **or** Sanity first, then the other/Strapi), `PlatformAdapter` interface, `cmsAdapter`, credential/OAuth handling, field mapping, draft-by-default write-back, verification.

**Out:** autonomous publishing without review (that's P5), platforms beyond the initial set, non-SEO fields.

---

## 3. Why the CMS Rail Is Necessary (and universal-consistent)

WordPress/Shopify/headless sites often have **no source PR** that expresses an SEO fix — the field lives in a database or CMS entry, edited via an admin UI or plugin (e.g., Yoast). The fix mechanism is a **CMS API write**, not a diff. This rail is what makes "support every website, even headless CMS" true in remediation, not just detection. Detection was already universal since Phase 1 (rendered HTML); Phase 4 completes remediation universality for the CMS-driven majority.

---

## 4. Architecture

```
Platform connect (OAuth/app) ──▶ Connection (kind: cms/shopify/wordpress, creds)
        │
        ▼
Platform Adapter: mapSurfaceFieldToCms(field, page)  → CMS entry + field ref
        │
Finding + RemediationInstruction (from P1/P2)
        │
        ▼
cmsAdapter.render(instruction, ctx):
   resolve CMS entry/field for the affected URL
   → write corrected value as DRAFT / staged change (default)
        │
        ▼
Verification: re-scan URL → confirm surface changed  → Outcome (applied|dismissed)
```

**New packages**
- `@awe/platforms` — `PlatformAdapter` interface + WordPress/Shopify/headless implementations + API clients.
- `@awe/remediation` — add `cmsAdapter`.

---

## 5. PlatformAdapter Interface

```ts
// @awe/platforms
interface PlatformContext { connectionId: string; url: string; }

interface CmsFieldRef { entryId: string; field: string; kind: "title" | "description" | "canonical" | "jsonLd" | "robots"; }

interface PlatformAdapter {
  readonly platform: string;                 // "wordpress" | "shopify" | "contentful" | ...
  resolveEntry(url: string, ctx: PlatformContext): Promise<CmsFieldRef | null>;
  writeField(ref: CmsFieldRef, value: string, opts: { draft: boolean }): Promise<{ ok: boolean; reviewUrl?: string }>;
}
```

- **WordPress:** REST API (`/wp/v2/posts|pages`) + SEO plugin fields where present (Yoast/RankMath meta), or a lightweight companion plugin for reliable field access. Draft = revision pending review.
- **Shopify:** Admin API — page/product SEO fields (`metafields`, `title_tag`, `meta_description`) and theme `<head>` for site-wide tags.
- **Headless (Contentful/Sanity/Strapi):** map surface fields to content-model fields; write via the management API; "draft" = unpublished entry/change set.
- Adapter returns `null` when it cannot resolve the field → fall back to Recommendation/Patch rails.

**Tasks**
- ☐ `PlatformAdapter` interface + registry.
- ☐ WordPress adapter (+ optional companion plugin) + field mapping.
- ☐ Shopify adapter.
- ☐ First headless CMS adapter; second as fast-follow.

---

## 6. cmsAdapter (Policy 4)

```ts
// @awe/remediation
export const cmsAdapter: RemediationAdapter = {
  policy: "cms",
  supports: (ctx) => Boolean(ctx.connections?.cms),
  render: async (instruction, ctx) => { /* resolve entry → writeField(draft:true) → return reviewUrl */ },
};
```

- **Draft/staged by default** — human approves in the CMS (or in-product), consistent with human-in-the-loop until Phase 5.
- Maps `instruction.targetSurfaceChange` (e.g. `{ canonical }`, `{ title }`, `{ description }`) to the platform field via the adapter; JSON-LD handled where the platform supports custom head/snippets.

**Tasks**
- ☐ `cmsAdapter` wiring instruction → adapter → draft write.
- ☐ In-product review/approve affordance + `reviewUrl` surfacing.

---

## 7. Credentials & OAuth

- OAuth/app install per platform; store tokens in the secrets manager with least-privilege scopes (content read/write only).
- Token refresh + revocation handling; per-connection audit of writes performed.

**Tasks**
- ☐ OAuth flows (WordPress app-password/OAuth, Shopify app, CMS management tokens).
- ☐ Secrets storage + refresh + revoke.

---

## 8. Write-Back Verification

- After a (approved) write, enqueue a re-scan of the affected URL; confirm the surface now reflects `targetSurfaceChange`; set `Outcome.verifiedByRescan`.
- If not reflected (e.g., caching/CDN), surface a clear "change not yet live" state with guidance.

---

## 9. Security & Privacy

- Least-privilege, content-scoped tokens; never request billing/admin scopes.
- Drafts by default — no public content changes without approval (aligns with the platform safety rules for publishing).
- Audit every field write (who/what/when/old→new) for reversibility.
- Data minimization: store field refs + values changed, not whole CMS entries.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| CMS field mapping wrong | Wrong content edited | Draft-by-default + verification re-scan; adapter returns `null` when unsure → fallback |
| SEO plugin variance (Yoast vs RankMath vs none) | Inconsistent WP support | Detect plugin; companion plugin for reliable access; fall back to theme head |
| CDN/caching hides the change | "Didn't work" perception | Verification re-scan + cache-aware messaging; optional cache purge where API allows |
| Token scope creep | Security/trust | Content-only scopes; audit; easy revoke |
| Non-technical buyer expects full automation | Support burden | Clear draft→approve UX; Phase 5 autonomous is opt-in later |

---

## 11. Work Breakdown

- **Epic A — Platform connections & OAuth** (§7)
- **Epic B — PlatformAdapter + WordPress** (§5)
- **Epic C — Shopify adapter** (§5)
- **Epic D — First headless CMS adapter** (§5)
- **Epic E — cmsAdapter + review/approve UX** (§6)
- **Epic F — Write-back verification** (§8)
- **Epic G — Dashboard: CMS affordances** — connect-CMS UI and the **draft review + one-click approve** flow, the non-technical owner's primary surface (`Customer_Dashboard.md` §4 P4).
- **Epic H — Superadmin: CMS ops** — view/revoke CMS connections, per-org platform-adapter flags (`Superadmin_Console.md` §9 P4).

---

## 12. Definition of Done

A site owner connects WordPress (and at least one other platform), and for supported issue types the platform resolves the CMS entry, writes the corrected SEO field **as a draft for approval**, and verifies via re-scan that the live surface changed — all from the same `RemediationInstruction`, with content-scoped least-privilege tokens and a full audit trail. Remediation is now universal in practice: git sites get PRs (P3), CMS sites get API writes (P4), and any site still gets Recommendation + Patch (P1) as the fallback. This sets up Phase 5, where approved, high-confidence changes can be applied autonomously for trusted enterprise accounts.
