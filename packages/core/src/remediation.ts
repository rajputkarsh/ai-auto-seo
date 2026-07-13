import type { SeoSurface } from "./surface";
import type { Finding } from "./finding";

export type RemediationPolicy =
  | "recommendation"
  | "patch"
  | "repo_pr"
  | "cms"
  | "autonomous";

/**
 * An execution-agnostic description of a desired fix.
 *
 * This is the central contract of the whole system: the reasoning engine emits
 * RemediationInstructions and NEVER decides how a fix is applied. Execution
 * adapters turn an instruction into a snippet, a unified diff, a pull request,
 * a CMS write, or an autonomous deploy. New rails are added without touching the
 * intelligence.
 */
export interface RemediationInstruction {
  finding: Finding;
  whatIsWrong: string;
  whyItMatters: string;
  /** Coarse impact label, e.g. "High" | "Medium" | "Low". */
  expectedImpact: string;
  /** 0..1. */
  confidence: number;
  /** The desired end-state, expressed as a partial surface change. */
  targetSurfaceChange: Partial<SeoSurface>;
  /** Concrete fix material, rendered differently by each policy. */
  canonicalFix: {
    /** Exact HTML to place in <head>, when applicable. */
    html?: string;
    /** Guidance for the diff / PR rails. */
    diffHint?: string;
  };
}

/** What an execution adapter is given about the page/site it is remediating. */
export interface SiteContext {
  url: string;
  /** Rendered HTML of the page, when available (required by the patch rail). */
  html?: string;
  connections?: {
    repo?: boolean;
    cms?: boolean;
  };
}

export interface RemediationOutput {
  policy: RemediationPolicy;
  instruction: RemediationInstruction;
  /** The produced artifact: a recommendation card, a unified diff, a PR url, etc. */
  artifact: string;
  meta?: Record<string, unknown>;
}

/** One implementation per remediation policy. */
export interface RemediationAdapter {
  readonly policy: RemediationPolicy;
  /** Whether this rail can act on the given context (e.g. patch needs html). */
  supports(ctx: SiteContext): boolean;
  render(instruction: RemediationInstruction, ctx: SiteContext): Promise<RemediationOutput>;
}
