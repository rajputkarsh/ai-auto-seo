export type Severity = "low" | "medium" | "high";

export type IssueType =
  | "missing_title"
  | "duplicate_title"
  | "missing_meta_description"
  | "missing_canonical"
  | "malformed_canonical"
  | "noindex_unexpected"
  | "missing_structured_data"
  | "invalid_structured_data"
  | "missing_h1"
  | "multiple_h1"
  | "sitemap_missing"
  | "robots_txt_blocks_crawling"
  /** Page returned 2xx on a previous scan and now returns an error status. */
  | "page_unavailable";

/**
 * A raw problem detected by a rule. Findings are the output of detection and the
 * input to reasoning. They carry evidence, not fixes.
 */
export interface Finding {
  issueType: IssueType;
  severity: Severity;
  url: string;
  route?: string;
  /** Human-readable statement of the problem, produced by the rule. */
  message: string;
  /**
   * True when this issue is newly introduced since the previous scan. A
   * regression is more urgent than a long-standing issue: something just broke,
   * the cause is probably the last deploy, and it is still fresh enough to
   * revert. Regressions rank above non-regressions of the same severity.
   */
  isRegression?: boolean;
  /** Prior/new values, when this finding comes from a regression (surface delta). */
  before?: unknown;
  after?: unknown;
  /** Structured evidence pulled from the surface. */
  evidence?: Record<string, unknown>;
}
