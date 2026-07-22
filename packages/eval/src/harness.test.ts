import { describe, expect, it } from "vitest";
import { loadCases, runEval } from "./harness";
import { checkGates, PRECISION_THRESHOLD } from "./report";
import type { EvalReport } from "./types";

describe("golden-set eval", () => {
  const cases = loadCases();

  it("loads every fixture case", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const c of cases) {
      expect(c.pages.length).toBeGreaterThan(0);
      expect(c.description).toBeTruthy();
    }
  });

  it("meets the precision gate across the whole golden set", () => {
    const report = runEval(cases);
    const gate = checkGates(report);
    // Surface the actual mismatches in the failure message rather than a bare boolean.
    expect(gate.failures).toEqual([]);
    expect(gate.passed).toBe(true);
    expect(report.overall.precision).toBeGreaterThanOrEqual(PRECISION_THRESHOLD);
  });

  it("produces zero findings on healthy multi-stack pages", () => {
    const healthy = cases.filter((c) => c.name.startsWith("healthy-"));
    expect(healthy.length).toBeGreaterThanOrEqual(3);
    const report = runEval(healthy);
    expect(report.overall.fp).toBe(0);
  });

  it("flags both pages of a duplicate-title case (site-wide rule)", () => {
    const dupes = cases.filter((c) => c.name === "duplicate-titles");
    const report = runEval(dupes);
    const metric = report.perIssue.find((m) => m.issueType === "duplicate_title");
    expect(metric?.tp).toBe(2);
    expect(metric?.fp).toBe(0);
  });
});

describe("gate logic", () => {
  const base = (over: Partial<EvalReport["perIssue"][number]>) => ({
    issueType: "missing_canonical",
    tp: 10,
    fp: 0,
    fn: 0,
    precision: 1,
    recall: 1,
    ...over,
  });

  const report = (perIssue: EvalReport["perIssue"]): EvalReport => ({
    caseCount: 1,
    pageCount: 1,
    perIssue,
    overall: { tp: 0, fp: 0, fn: 0, precision: 1, recall: 1 },
    mismatches: [],
  });

  it("fails a rule below the precision threshold", () => {
    const gate = checkGates(report([base({ tp: 8, fp: 2, precision: 0.8 })]));
    expect(gate.passed).toBe(false);
    expect(gate.failures[0]).toContain("precision");
  });

  it("passes a clean rule", () => {
    expect(checkGates(report([base({})])).passed).toBe(true);
  });
});
