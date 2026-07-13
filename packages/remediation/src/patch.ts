import type { RemediationAdapter, RemediationInstruction, RemediationOutput, SiteContext } from "@awe/core";
import { buildHeadInsertPatch, fileLabelFromUrl } from "./diff";

/**
 * Policy 2 — AI Patch (the MVP default). Universal and framework-independent:
 * produces a standard unified diff that inserts the fix into <head>. The developer
 * applies it wherever their <head> lives. No repo connection or framework adapter
 * required.
 */
export const patchAdapter: RemediationAdapter = {
  policy: "patch",
  supports(ctx: SiteContext) {
    return typeof ctx.html === "string" && ctx.html.length > 0;
  },
  async render(instruction: RemediationInstruction, ctx: SiteContext): Promise<RemediationOutput> {
    const insert = instruction.canonicalFix.html;
    if (!insert || !ctx.html) {
      return { policy: "patch", instruction, artifact: "", meta: { applicable: false } };
    }
    const result = buildHeadInsertPatch(ctx.html, insert, fileLabelFromUrl(ctx.url));
    if (!result) {
      return {
        policy: "patch",
        instruction,
        artifact: "",
        meta: { applicable: false, reason: "no </head> found" },
      };
    }
    return {
      policy: "patch",
      instruction,
      artifact: result.diff,
      meta: { patched: result.patched },
    };
  },
};
