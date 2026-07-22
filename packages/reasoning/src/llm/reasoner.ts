import type { Finding, IssueType, RemediationInstruction, SeoSurface } from "@awe/core";
import * as z from "zod/v4";
import { deterministicReasoner, type Reasoner, type ReasoningContext } from "../reason";
import { CAPABLE_MODEL, CHEAP_MODEL, type LlmClient } from "./client";
import type { CostGovernor } from "./cost";

/** Copy the capable model authors: real page-specific text. */
const GeneratedCopy = z.object({
  value: z.string(),
  rationale: z.string(),
});

/** The cheap model's job: resolve one ambiguous judgement call. */
const IntentClassification = z.object({
  likelyIntentional: z.boolean(),
  reason: z.string(),
});

/**
 * Issues where a model can author something a rule cannot: real, page-specific
 * copy. Everything else stays on the deterministic path — that routing is the
 * whole margin story, not an optimization detail.
 */
const GENERATIVE: ReadonlySet<IssueType> = new Set(["missing_title", "missing_meta_description"]);

/** Length bounds used both to instruct the model and to validate what it returns. */
const LIMITS: Partial<Record<IssueType, { min: number; max: number }>> = {
  missing_title: { min: 15, max: 60 },
  missing_meta_description: { min: 70, max: 160 },
};

export interface LlmReasonerOptions {
  client: LlmClient;
  governor: CostGovernor;
  /** Used whenever the model is skipped, over budget, or produces bad output. */
  fallback?: Reasoner;
  /** Observability hook; receives every routing decision. */
  onEvent?: (event: LlmReasonerEvent) => void;
}

export interface LlmReasonerEvent {
  issueType: IssueType;
  route: "deterministic" | "cheap" | "capable";
  reason?: string;
  costCents?: number;
  model?: string;
}

/**
 * LLM-backed reasoner, swapped in behind the same `Reasoner` interface.
 *
 * Design rules, in priority order:
 *  1. **Rules still detect.** The model only reasons and writes copy.
 *  2. **Route by value, not by default.** The capable model runs only where it
 *     can author something a rule cannot; the cheap model only resolves genuine
 *     ambiguity. Every other issue costs nothing.
 *  3. **Fail soft.** Budget exhaustion, an API error, or output that fails
 *     validation all degrade to the deterministic instruction — never an error.
 *  4. **Validate before it reaches a rail.** Generated text is length-checked and
 *     HTML-escaped before it can become a patch.
 */
export function createLlmReasoner(options: LlmReasonerOptions): Reasoner {
  const { client, governor, fallback = deterministicReasoner, onEvent } = options;

  return {
    async reason(
      finding: Finding,
      surface: SeoSurface,
      context?: ReasoningContext,
    ): Promise<RemediationInstruction> {
      const base = await fallback.reason(finding, surface, context);

      if (!governor.canAfford()) {
        onEvent?.({ issueType: finding.issueType, route: "deterministic", reason: "over budget" });
        return base;
      }

      try {
        if (GENERATIVE.has(finding.issueType)) {
          return await generateCopy(finding, surface, context, base, client, governor, onEvent);
        }
        if (finding.issueType === "noindex_unexpected") {
          return await classifyIntent(finding, surface, context, base, client, governor, onEvent);
        }
      } catch (error) {
        onEvent?.({
          issueType: finding.issueType,
          route: "deterministic",
          reason: `model call failed: ${describe(error)}`,
        });
        return base;
      }

      onEvent?.({ issueType: finding.issueType, route: "deterministic", reason: "rules suffice" });
      return base;
    },
  };
}

/** Capable model: write a real title / meta description from the page's content. */
async function generateCopy(
  finding: Finding,
  surface: SeoSurface,
  context: ReasoningContext | undefined,
  base: RemediationInstruction,
  client: LlmClient,
  governor: CostGovernor,
  onEvent?: (e: LlmReasonerEvent) => void,
): Promise<RemediationInstruction> {
  const limits = LIMITS[finding.issueType];
  const isTitle = finding.issueType === "missing_title";
  const what = isTitle ? "page title" : "meta description";

  const result = await client.call({
    model: CAPABLE_MODEL,
    // Effort is deliberately low: the task is small and bounded, and cost
    // discipline is a product requirement, not an afterthought.
    effort: "low",
    maxTokens: 8000,
    schema: GeneratedCopy,
    system:
      "You write technical-SEO copy. Return only the requested text — no surrounding quotes, no markup, no commentary.",
    user: [
      `Write a ${what} for this page.`,
      `URL: ${surface.url}`,
      surface.title ? `Existing title: ${surface.title}` : "",
      context?.pageText ? `Page content: ${context.pageText}` : "",
      limits ? `Length must be between ${limits.min} and ${limits.max} characters.` : "",
      "Be specific to this page's actual content. Do not invent facts absent from the content.",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const costCents = governor.record(result.model, result.usage);
  const value = result.value.value.trim();

  if (!withinLimits(value, limits)) {
    onEvent?.({
      issueType: finding.issueType,
      route: "capable",
      reason: `rejected: ${value.length} chars outside bounds`,
      costCents,
      model: result.model,
    });
    return base;
  }

  onEvent?.({ issueType: finding.issueType, route: "capable", costCents, model: result.model });

  const safe = escapeHtml(value);
  return {
    ...base,
    whyItMatters: base.whyItMatters,
    targetSurfaceChange: isTitle ? { title: value } : { description: value },
    canonicalFix: {
      html: isTitle ? `<title>${safe}</title>` : `<meta name="description" content="${safe}" />`,
      diffHint: result.value.rationale,
    },
  };
}

/**
 * Cheap model: decide whether a `noindex` looks deliberate.
 *
 * This is the one genuinely ambiguous call in the catalog — staging and
 * thank-you pages are *meant* to be excluded. A single snapshot can't settle it
 * from rules alone, so a cheap classification lowers confidence instead of
 * crying wolf. (Phase 2's regression deltas settle it properly when a prior
 * scan exists.)
 */
async function classifyIntent(
  finding: Finding,
  surface: SeoSurface,
  context: ReasoningContext | undefined,
  base: RemediationInstruction,
  client: LlmClient,
  governor: CostGovernor,
  onEvent?: (e: LlmReasonerEvent) => void,
): Promise<RemediationInstruction> {
  const result = await client.call({
    model: CHEAP_MODEL,
    maxTokens: 1024,
    schema: IntentClassification,
    system:
      "You classify whether a noindex directive on a web page is likely intentional. Staging, admin, checkout, thank-you, search-results and paginated pages are commonly noindexed on purpose. Primary content pages usually are not.",
    user: [
      `URL: ${surface.url}`,
      surface.title ? `Title: ${surface.title}` : "",
      context?.pageText ? `Content: ${context.pageText.slice(0, 600)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const costCents = governor.record(result.model, result.usage);
  onEvent?.({ issueType: finding.issueType, route: "cheap", costCents, model: result.model });

  if (!result.value.likelyIntentional) return base;

  // Looks deliberate — keep the finding but stop asserting it is a defect.
  return {
    ...base,
    confidence: Math.min(base.confidence, 0.4),
    expectedImpact: "Low",
    whyItMatters: `${base.whyItMatters} This page looks intentionally excluded (${result.value.reason}) — confirm before changing it.`,
  };
}

function withinLimits(value: string, limits?: { min: number; max: number }): boolean {
  if (!value) return false;
  if (!limits) return true;
  return value.length >= limits.min && value.length <= limits.max;
}

/** Escape generated text before it is embedded in markup by the patch rail. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
