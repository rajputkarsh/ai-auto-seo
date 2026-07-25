import type { SourcePatch } from "@awe/adapters";
import type { IssueType } from "@awe/core";
import { extractSurface } from "@awe/extractor";
import { evaluate } from "@awe/rules";

export interface BuildResult {
  ok: boolean;
  log?: string;
}

/**
 * Runs the project build for a patched working copy. Injected so the gate is
 * testable without Docker: production passes an ephemeral-container runner,
 * tests pass a stub. A gate with no build runner still performs surface
 * verification (below), which is the cheaper half of the guarantee.
 */
export type BuildRunner = (patch: SourcePatch) => Promise<BuildResult>;

export type GateVerdict =
  | { passed: true; patch: SourcePatch }
  | {
      passed: false;
      reason: "build_failed" | "not_resolved" | "new_issue" | "no_verifiable_output";
      detail?: string;
    };

export interface GateOptions {
  /** The issue the patch is supposed to fix. */
  issueType: IssueType;
  /** URL of the page whose surface should be re-checked after patching. */
  url: string;
  /**
   * Locate the patched HTML to re-extract. For static HTML the patched file IS
   * the output; for a framework the caller supplies rendered output from the
   * build. Returning null means "no verifiable output" (build-only gating).
   */
  renderedOutput?: (patch: SourcePatch) => string | null;
  /** Issue types present before the fix — a new one appearing fails the gate. */
  baseline?: Set<IssueType>;
  build?: BuildRunner;
}

/**
 * The trust guarantee: never surface a fix that breaks the build or fails to
 * resolve the issue.
 *
 * Two independent checks, both fail-closed:
 *  1. **Build** — if a runner is supplied, the patched tree must build.
 *  2. **Surface** — re-extract the fixed page's SEO surface and confirm the
 *     target issue is gone and no new issue type has appeared.
 *
 * This mirrors the pipeline's cheap `verifyPatch` but over real source files,
 * and is the same principle the docs call the sandbox build gate.
 */
export async function runBuildGate(patch: SourcePatch, options: GateOptions): Promise<GateVerdict> {
  if (options.build) {
    const build = await options.build(patch);
    if (!build.ok) return { passed: false, reason: "build_failed", detail: build.log };
  }

  const rendered = options.renderedOutput?.(patch) ?? defaultRendered(patch);
  if (rendered === null) {
    // Build passed but we cannot re-extract a surface to prove resolution.
    // Only acceptable when a build actually ran; otherwise nothing was verified.
    return options.build
      ? { passed: true, patch }
      : { passed: false, reason: "no_verifiable_output" };
  }

  const after = new Set(evaluate([extractSurface(rendered, options.url)]).map((f) => f.issueType));
  if (after.has(options.issueType)) {
    return { passed: false, reason: "not_resolved" };
  }
  if (options.baseline) {
    for (const type of after) {
      if (!options.baseline.has(type)) {
        return { passed: false, reason: "new_issue", detail: type };
      }
    }
  }
  return { passed: true, patch };
}

/**
 * When every diff is an HTML file, the patched content is itself the rendered
 * output, so we can verify without a build. Framework patches (.tsx) have no
 * directly-extractable output and return null.
 */
function defaultRendered(patch: SourcePatch): string | null {
  const htmlDiff = patch.diffs.find((d) => /\.html?$/i.test(d.path));
  return htmlDiff ? htmlDiff.patched : null;
}
