import type { RemediationInstruction } from "@awe/core";

/** One edited file within a source patch. */
export interface FileDiff {
  path: string;
  unifiedDiff: string;
  /** The full patched file content, so the build gate can write it directly. */
  patched: string;
}

/** A source-accurate fix expressed as diffs against real repository files. */
export interface SourcePatch {
  framework: string;
  diffs: FileDiff[];
}

export interface SourceContext {
  /** Checked-out working tree root (absolute path). */
  repoRoot: string;
  /** The route being fixed, e.g. "/pricing". */
  route: string;
  /** Candidate source files for this route, from `mapRoute`. */
  files: string[];
}

/**
 * Translates an execution-agnostic `RemediationInstruction` into an idiomatic
 * source edit for one framework.
 *
 * This is the hard, defensible layer: it is the only part of the system that
 * needs to understand a specific stack. Everything upstream (detection,
 * reasoning) is framework-blind. An adapter that cannot safely express a fix
 * returns `null`, and the platform falls back to the universal Patch rail — so
 * partial framework support never means worse coverage than a plain diff.
 */
export interface FrameworkAdapter {
  readonly framework: string;
  /** Whether this adapter recognises the repository at `repoRoot`. */
  detect(repoRoot: string): Promise<boolean>;
  /** Source files that render `route`, most-specific first. */
  mapRoute(route: string, repoRoot: string): Promise<string[]>;
  /** Produce a source patch, or null when the fix can't be expressed safely. */
  applyToSource(
    instruction: RemediationInstruction,
    ctx: SourceContext,
  ): Promise<SourcePatch | null>;
}
