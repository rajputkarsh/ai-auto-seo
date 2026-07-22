import type { EvalReport } from "./types";

/** The program-wide precision gate (00_Overview.md §5). */
export const PRECISION_THRESHOLD = 0.95;
/** Recall is reported and loosely gated: a miss is far cheaper than a false alarm. */
export const RECALL_THRESHOLD = 0.8;

export interface GateResult {
  passed: boolean;
  failures: string[];
}

export function checkGates(report: EvalReport): GateResult {
  const failures: string[] = [];
  for (const m of report.perIssue) {
    if (m.precision < PRECISION_THRESHOLD) {
      failures.push(
        `${m.issueType}: precision ${pct(m.precision)} < ${pct(PRECISION_THRESHOLD)} (${m.fp} false positive(s))`,
      );
    }
    if (m.recall < RECALL_THRESHOLD) {
      failures.push(
        `${m.issueType}: recall ${pct(m.recall)} < ${pct(RECALL_THRESHOLD)} (${m.fn} missed)`,
      );
    }
  }
  return { passed: failures.length === 0, failures };
}

export function formatReport(report: EvalReport, gate: GateResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `Golden-set eval — ${report.caseCount} case(s), ${report.pageCount} page(s), threshold: precision ≥ ${pct(PRECISION_THRESHOLD)}`,
  );
  lines.push("");
  lines.push(row("issue type", "TP", "FP", "FN", "prec", "recall"));
  lines.push("─".repeat(60));
  for (const m of report.perIssue) {
    lines.push(
      row(m.issueType, String(m.tp), String(m.fp), String(m.fn), pct(m.precision), pct(m.recall)),
    );
  }
  lines.push("─".repeat(60));
  const o = report.overall;
  lines.push(
    row("OVERALL", String(o.tp), String(o.fp), String(o.fn), pct(o.precision), pct(o.recall)),
  );

  if (report.mismatches.length > 0) {
    lines.push("");
    lines.push("Mismatches:");
    for (const m of report.mismatches) {
      const symbol = m.kind === "false_positive" ? "FP" : "FN";
      lines.push(`  [${symbol}] ${m.case} ${m.url} → ${m.issueType}`);
    }
  }

  lines.push("");
  lines.push(gate.passed ? "✅ eval gates passed" : "❌ eval gates FAILED");
  for (const f of gate.failures) lines.push(`   - ${f}`);
  lines.push("");
  return lines.join("\n");
}

/** One fixed-width row of the metrics table. */
function row(
  issueType: string,
  tp: string,
  fp: string,
  fn: string,
  precision: string,
  recall: string,
): string {
  return [pad(issueType, 28), pad(tp, 5), pad(fp, 5), pad(fn, 5), pad(precision, 8), recall].join(
    "",
  );
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value + " ".repeat(width - value.length);
}
