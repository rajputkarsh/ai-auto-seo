import type { RemediationAdapter, RemediationInstruction, RemediationOutput } from "@awe/core";

/**
 * Policy 1 — Recommendation. Universal, zero-risk, needs no adapters or repo.
 * Renders an instruction as a human-readable card: what/why/impact/confidence + fix.
 */
export const recommendationAdapter: RemediationAdapter = {
  policy: "recommendation",
  supports() {
    return true; // works on every website
  },
  async render(instruction: RemediationInstruction): Promise<RemediationOutput> {
    const pct = Math.round(instruction.confidence * 100);
    const fix =
      instruction.canonicalFix.html ?? instruction.canonicalFix.diffHint ?? "See guidance.";
    const artifact = [
      `Issue: ${instruction.finding.issueType}`,
      `What's wrong: ${instruction.whatIsWrong}`,
      `Why it matters: ${instruction.whyItMatters}`,
      `Impact: ${instruction.expectedImpact}`,
      `Confidence: ${pct}%`,
      `Suggested fix:`,
      `  ${fix}`,
    ].join("\n");
    return { policy: "recommendation", instruction, artifact };
  },
};
