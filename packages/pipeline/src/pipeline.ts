import type {
  Finding,
  IssueType,
  RemediationInstruction,
  SeoSurface,
  SiteContext,
} from "@awe/core";
import { extractSurface, extractText } from "@awe/extractor";
import { diffSurfaces, mergeFindings } from "@awe/graph";
import { deterministicReasoner, type Reasoner } from "@awe/reasoning";
import {
  applyHeadInsert,
  applyReplace,
  diffDocuments,
  fileLabelFromUrl,
  patchAdapter,
  recommendationAdapter,
} from "@awe/remediation";
import { evaluate } from "@awe/rules";

export interface ScanResultItem {
  finding: Finding;
  instruction: RemediationInstruction;
  /** Policy 1 output (always present — universal). */
  recommendation: string;
  /**
   * Policy 2 output. Present only when a patch was produced AND verified to
   * resolve the issue without introducing new ones.
   */
  patch?: string;
  /** Why no patch is offered, when one could not be produced or verified. */
  patchUnavailable?: string;
}

export interface ScanResult {
  url: string;
  surface: SeoSurface;
  items: ScanResultItem[];
  /**
   * A single diff applying every automatable fix at once, so a developer can
   * apply one patch instead of N. Present when ≥2 fixes are automatable and the
   * combined result verifies.
   */
  combinedPatch?: string;
}

/**
 * The composition root: rendered HTML in, detected + reasoned + remediated result out.
 *
 *   extract surface -> detect findings -> reason into instructions -> render rails -> verify
 *
 * The Reasoner is injectable so an LLM-backed reasoner can replace the deterministic
 * one without changing callers.
 */
export interface ScanOptions {
  reasoner?: Reasoner;
  /**
   * The same URL's surface from a previous scan. When supplied, issues that are
   * newly introduced are reported as regressions with before/after evidence and
   * ranked above long-standing issues of the same severity.
   */
  previous?: SeoSurface;
  /** Property-level facts (robots.txt / sitemap) fetched once per site. */
  siteWide?: SeoSurface["siteWide"];
}

export async function runScan(
  html: string,
  url: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const reasoner = options.reasoner ?? deterministicReasoner;
  const surface = extractSurface(html, url);
  if (options.siteWide) surface.siteWide = options.siteWide;

  const regressions = options.previous ? diffSurfaces(options.previous, surface) : [];
  const findings = prioritize(mergeFindings(evaluate([surface]), regressions));

  const result: ScanResult = {
    url,
    surface,
    items: await remediate(findings, surface, html, url, reasoner),
  };
  const combined = buildCombinedPatch(
    html,
    url,
    result.items,
    new Set(findings.map((f) => f.issueType)),
  );
  if (combined) result.combinedPatch = combined;
  return result;
}

/**
 * Turn findings for one page into reasoned, remediated, verified items.
 * Shared by the single-page and whole-site entry points.
 */
export async function remediate(
  findings: Finding[],
  surface: SeoSurface,
  html: string,
  url: string,
  reasoner: Reasoner,
): Promise<ScanResultItem[]> {
  const ctx: SiteContext = { url, html };
  const baseline = new Set(findings.map((f) => f.issueType));

  // Page text is only needed by a model-backed reasoner; extract it once.
  const pageText = extractText(html);

  return Promise.all(
    findings.map(async (finding): Promise<ScanResultItem> => {
      const instruction = await reasoner.reason(finding, surface, { pageText });
      const rec = await recommendationAdapter.render(instruction, ctx);
      const item: ScanResultItem = { finding, instruction, recommendation: rec.artifact };

      if (!instruction.canonicalFix.html) {
        item.patchUnavailable = "fix requires manual judgement";
        return item;
      }
      if (!patchAdapter.supports(ctx)) {
        item.patchUnavailable = "no page HTML available";
        return item;
      }

      const patch = await patchAdapter.render(instruction, ctx);
      const patched = patch.meta?.patched;
      if (!patch.artifact || typeof patched !== "string") {
        item.patchUnavailable = String(patch.meta?.reason ?? "patch not applicable");
        return item;
      }
      if (!verifyPatch(patched, url, finding.issueType, baseline)) {
        // The patch did not achieve the target surface — never show it.
        item.patchUnavailable = "generated patch failed verification";
        return item;
      }

      item.patch = patch.artifact;
      return item;
    }),
  );
}

/**
 * Confirm a patched document actually fixes what it claimed and breaks nothing:
 * the targeted issue must disappear, and no issue type absent from the original
 * scan may appear. Cheap here (pure re-extraction) and the same principle as the
 * Phase-3 sandbox build gate.
 */
function verifyPatch(
  patchedHtml: string,
  url: string,
  issueType: IssueType,
  baseline: Set<IssueType>,
): boolean {
  const after = new Set(evaluate([extractSurface(patchedHtml, url)]).map((f) => f.issueType));
  if (after.has(issueType)) return false;
  for (const type of after) {
    if (!baseline.has(type)) return false;
  }
  return true;
}

/** Apply every automatable fix to one document and emit a single verified diff. */
function buildCombinedPatch(
  html: string,
  url: string,
  items: ScanResultItem[],
  baseline: Set<IssueType>,
): string | undefined {
  const automatable = items.filter((item) => item.patch && item.instruction.canonicalFix.html);
  if (automatable.length < 2) return undefined;

  // Replacements first: they target existing elements, so applying them before
  // insertions keeps selectors matching the original document's structure.
  const ordered = [
    ...automatable.filter((i) => i.instruction.canonicalFix.replaceSelector),
    ...automatable.filter((i) => !i.instruction.canonicalFix.replaceSelector),
  ];

  let working = html;
  for (const item of ordered) {
    const { html: fixHtml, replaceSelector } = item.instruction.canonicalFix;
    if (!fixHtml) continue;
    const next = replaceSelector
      ? applyReplace(working, replaceSelector, fixHtml)
      : applyHeadInsert(working, fixHtml);
    if (next === null) return undefined;
    working = next;
  }

  const remaining = new Set(evaluate([extractSurface(working, url)]).map((f) => f.issueType));
  for (const item of ordered) {
    if (remaining.has(item.finding.issueType)) return undefined;
  }
  for (const type of remaining) {
    if (!baseline.has(type)) return undefined;
  }

  return diffDocuments(html, working, fileLabelFromUrl(url));
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { high: 0, medium: 1, low: 2 };

/**
 * Order findings most-damaging first: severity, then regressions ahead of
 * long-standing issues of equal severity (something just broke and is probably
 * still revertible), then issue type so output is stable across runs.
 */
export function prioritize(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Number(b.isRegression ?? false) - Number(a.isRegression ?? false) ||
      a.issueType.localeCompare(b.issueType),
  );
}
