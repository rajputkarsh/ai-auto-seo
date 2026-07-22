import type { Finding } from "@awe/core";

/**
 * Combine steady-state rule findings with regression findings.
 *
 * The two overlap by design: when a title disappears, the rules report
 * `missing_title` and the delta reports the same issue as a regression. The
 * regression version wins, because it carries the before/after evidence and the
 * knowledge that this just broke — but we never emit the issue twice.
 */
export function mergeFindings(ruleFindings: Finding[], regressions: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();

  for (const finding of ruleFindings) {
    byKey.set(key(finding), finding);
  }
  for (const regression of regressions) {
    const existing = byKey.get(key(regression));
    // Keep the rule's richer message/evidence where it exists, but promote it
    // to a regression with the delta's before/after context.
    byKey.set(
      key(regression),
      existing
        ? {
            ...existing,
            isRegression: true,
            before: regression.before,
            after: regression.after,
            message: regression.message,
            severity: existing.severity,
          }
        : regression,
    );
  }

  return [...byKey.values()];
}

function key(finding: Finding): string {
  return `${finding.url}::${finding.issueType}`;
}
