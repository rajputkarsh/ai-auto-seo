/** One labelled page inside a golden case. */
export interface GoldenPage {
  /** HTML filename relative to the case directory. */
  file: string;
  url: string;
  /** Issue types this page is expected to produce. Empty = a healthy page. */
  expected: string[];
}

/**
 * A golden case is one or more pages evaluated together, so that site-wide
 * rules (e.g. duplicate_title) can see sibling pages.
 */
export interface GoldenCase {
  name: string;
  description?: string;
  pages: GoldenPage[];
}

export interface IssueMetrics {
  issueType: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

export interface Mismatch {
  case: string;
  url: string;
  kind: "false_positive" | "false_negative";
  issueType: string;
}

export interface EvalReport {
  caseCount: number;
  pageCount: number;
  perIssue: IssueMetrics[];
  overall: { tp: number; fp: number; fn: number; precision: number; recall: number };
  mismatches: Mismatch[];
}
