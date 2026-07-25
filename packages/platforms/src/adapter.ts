import type { IssueType, RemediationInstruction, SeoSurface } from "@awe/core";

/** The SEO field a fix targets, mapped onto CMS-neutral terms. */
export type FieldKind = "title" | "description" | "canonical" | "robots";

/** A concrete field write: which SEO field, and the value to set. */
export interface FieldWrite {
  kind: FieldKind;
  value: string;
}

/** A resolved CMS entry that renders a URL. */
export interface CmsEntry {
  entryId: string;
  /** Platform-specific type, e.g. "page" | "post" | "product". */
  type: string;
}

export interface PlatformContext {
  connectionId: string;
  url: string;
}

export interface WriteResult {
  ok: boolean;
  /** Where a human reviews/approves the staged change. */
  reviewUrl?: string;
  detail?: string;
}

/**
 * Writes an SEO fix into a CMS/commerce platform via its API.
 *
 * This is the non-git execution mechanism that completes remediation
 * universality: WordPress/Shopify/headless sites have no source PR to open —
 * the field lives in a database — so the fix is an API write, not a diff. Like
 * the framework adapters, a platform adapter returns `null` when it cannot
 * resolve the entry, and the caller falls back to the Recommendation/Patch rail.
 */
export interface PlatformAdapter {
  readonly platform: string;
  /** Find the entry that renders `url`, or null if none maps. */
  resolveEntry(url: string, ctx: PlatformContext): Promise<CmsEntry | null>;
  /**
   * Write a field. `draft: true` (the default policy) stages the change for
   * human review rather than publishing it live.
   */
  writeField(
    entry: CmsEntry,
    write: FieldWrite,
    opts: { draft: boolean },
    ctx: PlatformContext,
  ): Promise<WriteResult>;
}

/**
 * Map a remediation instruction to a concrete CMS field write, or null when the
 * fix isn't a simple field the CMS rail can own (e.g. structured data, or a
 * body-level change) — those fall back to the universal rails.
 */
export function fieldWriteFor(instruction: RemediationInstruction): FieldWrite | null {
  const issue = instruction.finding.issueType;
  const target = instruction.targetSurfaceChange as Partial<SeoSurface>;

  const map: Partial<Record<IssueType, () => FieldWrite | null>> = {
    missing_title: () => (target.title ? { kind: "title", value: target.title } : null),
    duplicate_title: () => (target.title ? { kind: "title", value: target.title } : null),
    missing_meta_description: () =>
      target.description !== undefined
        ? { kind: "description", value: target.description || "" }
        : null,
    missing_canonical: () =>
      target.canonical ? { kind: "canonical", value: target.canonical } : null,
    malformed_canonical: () =>
      target.canonical ? { kind: "canonical", value: target.canonical } : null,
    noindex_unexpected: () => ({ kind: "robots", value: "index, follow" }),
  };

  return map[issue]?.() ?? null;
}
