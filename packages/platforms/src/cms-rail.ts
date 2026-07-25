import type { RemediationInstruction } from "@awe/core";
import { fieldWriteFor, type PlatformAdapter, type PlatformContext } from "./adapter";
import type { CmsOutcomeStore } from "./outcomes";

export interface CmsRailContext extends PlatformContext {
  orgId: string;
  /** Draft-by-default: stage for human review rather than publish live. */
  draft?: boolean;
}

export interface CmsRailItem {
  issueType: string;
  outcome:
    | { rail: "cms"; kind: string; reviewUrl?: string }
    | { rail: "fallback"; reason: "unwritable_field" | "unresolvable_entry" | "write_failed" };
}

export interface CmsRailSummary {
  items: CmsRailItem[];
  drafted: number;
  fellBack: number;
}

export interface CmsRailDeps {
  adapter: PlatformAdapter;
  outcomes?: CmsOutcomeStore;
}

/**
 * Run the CMS rail across a page's findings.
 *
 * Same contract as the repo rail: each finding independently produces a CMS
 * write or a fallback, and a decline never blocks the others — so a
 * CMS-connected site strictly gains staged fixes and never loses coverage.
 * Writes are drafts by default (human-in-the-loop until Phase 5), recorded for
 * the applied-fix metric.
 */
export async function applyCmsRail(
  instructions: RemediationInstruction[],
  ctx: CmsRailContext,
  deps: CmsRailDeps,
): Promise<CmsRailSummary> {
  const draft = ctx.draft ?? true;
  const items: CmsRailItem[] = [];

  // Resolve the entry once per URL — all fixes on a page share it.
  const entryCache = new Map<string, Awaited<ReturnType<PlatformAdapter["resolveEntry"]>>>();

  for (const instruction of instructions) {
    const write = fieldWriteFor(instruction);
    if (!write) {
      items.push({
        issueType: instruction.finding.issueType,
        outcome: { rail: "fallback", reason: "unwritable_field" },
      });
      continue;
    }

    const url = instruction.finding.url;
    if (!entryCache.has(url)) {
      entryCache.set(
        url,
        await deps.adapter.resolveEntry(url, { connectionId: ctx.connectionId, url }),
      );
    }
    const entry = entryCache.get(url) ?? null;
    if (!entry) {
      items.push({
        issueType: instruction.finding.issueType,
        outcome: { rail: "fallback", reason: "unresolvable_entry" },
      });
      continue;
    }

    const result = await deps.adapter.writeField(
      entry,
      write,
      { draft },
      { connectionId: ctx.connectionId, url },
    );
    if (!result.ok) {
      items.push({
        issueType: instruction.finding.issueType,
        outcome: { rail: "fallback", reason: "write_failed" },
      });
      continue;
    }

    await deps.outcomes?.recordDraft({
      orgId: ctx.orgId,
      url,
      issueType: instruction.finding.issueType,
      kind: write.kind,
      ...(result.reviewUrl ? { reviewUrl: result.reviewUrl } : {}),
    });
    items.push({
      issueType: instruction.finding.issueType,
      outcome: {
        rail: "cms",
        kind: write.kind,
        ...(result.reviewUrl ? { reviewUrl: result.reviewUrl } : {}),
      },
    });
  }

  const drafted = items.filter((i) => i.outcome.rail === "cms").length;
  return { items, drafted, fellBack: items.length - drafted };
}
