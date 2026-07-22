import type { Finding } from "./finding";
import type { SeoSurface } from "./surface";

export type RemediationPolicy = "recommendation" | "patch" | "repo_pr" | "cms" | "autonomous";

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
  /**
   * Concrete fix material, rendered differently by each policy.
   *
   * Must stay JSON-serializable — instructions are persisted from Phase 2 on.
   */
  canonicalFix: {
    /** The exact HTML the fixed element should be. */
    html?: string;
    /**
     * CSS selector of an existing element that `html` should REPLACE.
     * When absent, `html` is inserted before </head> instead. Replacement is
     * required whenever adding a second tag would not fix the problem (e.g. a
     * `noindex` robots meta) or would be invalid.
     */
    replaceSelector?: string;
    /** Guidance for the diff / PR rails, and for fixes no rail can automate. */
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
