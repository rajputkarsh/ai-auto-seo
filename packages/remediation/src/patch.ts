import type {
  RemediationAdapter,
  RemediationInstruction,
  RemediationOutput,
  SiteContext,
} from "@awe/core";
import {
  buildHeadInsertPatch,
  buildReplacePatch,
  fileLabelFromUrl,
  type PatchResult,
} from "./diff";

/**
 * Policy 2 — AI Patch (the MVP default). Universal and framework-independent:
 * produces a standard unified diff the developer applies wherever their markup
 * lives. No repo connection or framework adapter required.
 *
 * Two modes, chosen by the instruction:
 *  - `replaceSelector` present → replace that element (needed when adding a
 *    second tag would not fix the issue, e.g. a `noindex` robots meta).
 *  - otherwise → insert `html` before </head>.
 */
export const patchAdapter: RemediationAdapter = {
  policy: "patch",
  supports(ctx: SiteContext) {
    return typeof ctx.html === "string" && ctx.html.length > 0;
  },
  async render(instruction: RemediationInstruction, ctx: SiteContext): Promise<RemediationOutput> {
    const { html: fixHtml, replaceSelector } = instruction.canonicalFix;
    if (!fixHtml || !ctx.html) {
      return { policy: "patch", instruction, artifact: "", meta: { applicable: false } };
    }

    const label = fileLabelFromUrl(ctx.url);
    const result: PatchResult | null = replaceSelector
      ? buildReplacePatch(ctx.html, replaceSelector, fixHtml, label)
      : buildHeadInsertPatch(ctx.html, fixHtml, label);

    if (!result) {
      return {
        policy: "patch",
        instruction,
        artifact: "",
        meta: {
          applicable: false,
          reason: replaceSelector ? `no element matched ${replaceSelector}` : "no </head> found",
        },
      };
    }

    return {
      policy: "patch",
      instruction,
      artifact: result.diff,
      meta: { patched: result.patched, mode: replaceSelector ? "replace" : "insert" },
    };
  },
};
