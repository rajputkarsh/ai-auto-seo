import type { Finding, RemediationInstruction, SeoSurface, SiteContext } from "@awe/core";
import { extractSurface } from "@awe/extractor";
import { evaluate } from "@awe/rules";
import { deterministicReasoner, type Reasoner } from "@awe/reasoning";
import { recommendationAdapter, patchAdapter } from "@awe/remediation";

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
  const findings = evaluate([surface]);
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
