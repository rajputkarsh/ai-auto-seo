import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { RemediationInstruction } from "@awe/core";
import { buildHeadInsertPatch, buildReplacePatch } from "@awe/remediation";
import type { FrameworkAdapter, SourceContext, SourcePatch } from "./adapter";

/**
 * Static-HTML adapter.
 *
 * The simplest possible framework mapping — because the source file *is* the
 * output, both the route→file map and the edit are direct. It reuses the exact
 * same head-insert / replace-in-place diff logic the universal Patch rail uses,
 * only applied to a real file on disk instead of a fetched response, so a
 * repo-connected static site gets a genuine PR rather than a copy-paste snippet.
 */
export const staticHtmlAdapter: FrameworkAdapter = {
  framework: "static-html",

  async detect(repoRoot) {
    // A framework repo (Next.js etc.) owns its HTML output; treat those as not
    // ours even if a stray .html exists. Presence of a root index.html with no
    // Node package manifest is the static-site signal.
    if (await exists(join(repoRoot, "package.json"))) return false;
    return exists(join(repoRoot, "index.html"));
  },

  async mapRoute(route, repoRoot) {
    const candidates = candidatePaths(route);
    const present: string[] = [];
    for (const rel of candidates) {
      if (await exists(join(repoRoot, rel))) present.push(rel);
    }
    return present;
  },

  async applyToSource(instruction, ctx) {
    const { html, replaceSelector } = instruction.canonicalFix;
    // No head-level HTML means a body/guidance fix the source rail can't own.
    if (!html) return null;

    for (const rel of ctx.files) {
      const abs = join(ctx.repoRoot, rel);
      let source: string;
      try {
        source = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      const label = relative(ctx.repoRoot, abs) || rel;
      const result = replaceSelector
        ? buildReplacePatch(source, replaceSelector, html, label)
        : buildHeadInsertPatch(source, html, label);
      if (result) {
        return {
          framework: this.framework,
          diffs: [{ path: rel, unifiedDiff: result.diff, patched: result.patched }],
        };
      }
    }
    return null;
  },
};

/** Route → candidate relative file paths. `/` and `/x` both handled. */
function candidatePaths(route: string): string[] {
  const clean = route.split(/[?#]/)[0] ?? "/";
  const trimmed = clean.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return ["index.html"];
  return [`${trimmed}.html`, `${trimmed}/index.html`];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
