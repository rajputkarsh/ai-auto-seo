import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SeoSurface } from "@awe/core";
import { extractSurface } from "@awe/extractor";
import { evaluate } from "@awe/rules";
import type { EvalReport, GoldenCase, IssueMetrics, Mismatch } from "./types";

export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

/** Load every golden case from a fixtures directory. */
export function loadCases(dir: string = FIXTURES_DIR): GoldenCase[] {
  const cases: GoldenCase[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const caseDir = join(dir, entry);
    if (!statSync(caseDir).isDirectory()) continue;
    const manifest = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as Omit<
      GoldenCase,
      "name"
    >;
    cases.push({ name: entry, ...manifest });
  }
  return cases;
}

/**
 * Run one case: extract every page's surface, evaluate them together (so
 * site-wide rules see siblings), and return detected issue types per URL.
 */
export function detectForCase(caseDir: string, golden: GoldenCase): Map<string, Set<string>> {
  const surfaces: SeoSurface[] = golden.pages.map((page) => {
    const html = readFileSync(join(caseDir, page.file), "utf8");
    return extractSurface(html, page.url);
  });

  const detected = new Map<string, Set<string>>();
  for (const page of golden.pages) detected.set(page.url, new Set());
  for (const finding of evaluate(surfaces)) {
    detected.get(finding.url)?.add(finding.issueType);
  }
  return detected;
}

/** Evaluate all cases and compute per-issue and overall precision/recall. */
export function runEval(cases: GoldenCase[], dir: string = FIXTURES_DIR): EvalReport {
  const counts = new Map<string, { tp: number; fp: number; fn: number }>();
  const mismatches: Mismatch[] = [];
  let pageCount = 0;

  const bump = (issueType: string, key: "tp" | "fp" | "fn") => {
    const entry = counts.get(issueType) ?? { tp: 0, fp: 0, fn: 0 };
    entry[key] += 1;
    counts.set(issueType, entry);
  };

  for (const golden of cases) {
    const detectedByUrl = detectForCase(join(dir, golden.name), golden);
    for (const page of golden.pages) {
      pageCount += 1;
      const detected = detectedByUrl.get(page.url) ?? new Set<string>();
      const expected = new Set(page.expected);

      for (const issueType of detected) {
        if (expected.has(issueType)) {
          bump(issueType, "tp");
        } else {
          bump(issueType, "fp");
          mismatches.push({ case: golden.name, url: page.url, kind: "false_positive", issueType });
        }
      }
      for (const issueType of expected) {
        if (!detected.has(issueType)) {
          bump(issueType, "fn");
          mismatches.push({ case: golden.name, url: page.url, kind: "false_negative", issueType });
        }
      }
    }
  }

  const perIssue: IssueMetrics[] = [...counts.entries()]
    .map(([issueType, c]) => ({
      issueType,
      ...c,
      precision: ratio(c.tp, c.tp + c.fp),
      recall: ratio(c.tp, c.tp + c.fn),
    }))
    .sort((a, b) => a.issueType.localeCompare(b.issueType));

  const totals = perIssue.reduce(
    (acc, m) => ({ tp: acc.tp + m.tp, fp: acc.fp + m.fp, fn: acc.fn + m.fn }),
    { tp: 0, fp: 0, fn: 0 },
  );

  return {
    caseCount: cases.length,
    pageCount,
    perIssue,
    overall: {
      ...totals,
      precision: ratio(totals.tp, totals.tp + totals.fp),
      recall: ratio(totals.tp, totals.tp + totals.fn),
    },
    mismatches,
  };
}

/** No predictions (or no expectations) counts as perfect rather than 0/0 = NaN. */
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}
