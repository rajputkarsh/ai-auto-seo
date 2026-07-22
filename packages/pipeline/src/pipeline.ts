import type { Finding, RemediationInstruction, SeoSurface, SiteContext } from "@awe/core";
import { extractSurface } from "@awe/extractor";
import { deterministicReasoner, type Reasoner } from "@awe/reasoning";
import { patchAdapter, recommendationAdapter } from "@awe/remediation";
import { evaluate } from "@awe/rules";

export interface ScanResultItem {
  finding: Finding;
  instruction: RemediationInstruction;
  /** Policy 1 output (always present — universal). */
  recommendation: string;
  /** Policy 2 output (present when the page HTML is patchable). */
  patch?: string;
}

export interface ScanResult {
  url: string;
  surface: SeoSurface;
  items: ScanResultItem[];
}

/**
 * The composition root: rendered HTML in, detected+reasoned+remediated result out.
 *
 *   extract surface -> detect findings -> reason into instructions -> render rails
 *
 * The Reasoner is injectable so an LLM-backed reasoner can replace the deterministic
 * one without changing callers.
 */
export async function runScan(
  html: string,
  url: string,
  reasoner: Reasoner = deterministicReasoner,
): Promise<ScanResult> {
  const surface = extractSurface(html, url);
  const findings = prioritize(evaluate([surface]));
  const ctx: SiteContext = { url, html };

  const items = await Promise.all(
    findings.map(async (finding): Promise<ScanResultItem> => {
      const instruction = reasoner.reason(finding, surface);
      const rec = await recommendationAdapter.render(instruction, ctx);
      const item: ScanResultItem = { finding, instruction, recommendation: rec.artifact };
      if (patchAdapter.supports(ctx)) {
        const patch = await patchAdapter.render(instruction, ctx);
        if (patch.artifact) item.patch = patch.artifact;
      }
      return item;
    }),
  );

  return { url, surface, items };
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { high: 0, medium: 1, low: 2 };

/**
 * Order findings most-damaging first, tie-broken by issue type so output is
 * stable across runs (important for diffable reports and snapshot tests).
 */
export function prioritize(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.issueType.localeCompare(b.issueType),
  );
}
