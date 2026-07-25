import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { IssueType, RemediationInstruction, SeoSurface } from "@awe/core";
import { diffDocuments } from "@awe/remediation";
import type { FrameworkAdapter, SourceContext, SourcePatch } from "./adapter";

const PAGE_EXTS = ["tsx", "ts", "jsx", "js"];

/**
 * Next.js adapter (App Router first).
 *
 * The idiomatic fix is a `metadata` export in the route's `page` file, not an
 * edit to rendered HTML. This adapter handles the clean, safe case — a page
 * with *no* existing `metadata`/`generateMetadata` — by inserting a metadata
 * export. Anything requiring us to rewrite an existing metadata object or a
 * `generateMetadata` function returns `null`: doing that safely needs real AST
 * surgery, and a wrong edit to a customer's source is far worse than falling
 * back to the universal Patch rail. Conservative-but-correct beats broad-but-risky.
 */
export const nextjsAdapter: FrameworkAdapter = {
  framework: "nextjs",

  async detect(repoRoot) {
    const pkgPath = join(repoRoot, "package.json");
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      if (pkg.dependencies?.next || pkg.devDependencies?.next) return true;
    } catch {
      // no/invalid package.json
    }
    for (const ext of ["js", "mjs", "ts"]) {
      if (await exists(join(repoRoot, `next.config.${ext}`))) return true;
    }
    return false;
  },

  async mapRoute(route, repoRoot) {
    const seg = route.split(/[?#]/)[0]?.replace(/^\/+|\/+$/g, "") ?? "";
    const present: string[] = [];

    // App Router: app/<seg>/page.ext (root -> app/page.ext), plus src/app.
    for (const base of ["app", "src/app"]) {
      const dir = seg === "" ? base : `${base}/${seg}`;
      for (const ext of PAGE_EXTS) {
        const rel = `${dir}/page.${ext}`;
        if (await exists(join(repoRoot, rel))) present.push(rel);
      }
    }
    // Pages Router: pages/<seg>.ext and pages/<seg>/index.ext.
    for (const base of ["pages", "src/pages"]) {
      const stem = seg === "" ? `${base}/index` : `${base}/${seg}`;
      for (const ext of PAGE_EXTS) {
        for (const rel of [`${stem}.${ext}`, `${base}/${seg}/index.${ext}`]) {
          if (seg === "" && rel.includes(`/${seg}/`)) continue;
          if (await exists(join(repoRoot, rel))) present.push(rel);
        }
      }
    }
    return [...new Set(present)];
  },

  async applyToSource(instruction, ctx) {
    const fragment = metadataFragment(instruction.finding.issueType, instruction);
    if (!fragment) return null; // not an insertable metadata field

    for (const rel of ctx.files) {
      const abs = join(ctx.repoRoot, rel);
      let source: string;
      try {
        source = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      // Existing metadata surface -> too risky to rewrite without AST. Fall back.
      if (
        /export\s+(?:const\s+metadata\b|async\s+function\s+generateMetadata\b|function\s+generateMetadata\b)/.test(
          source,
        )
      ) {
        return null;
      }

      const patched = insertMetadataExport(source, fragment);
      if (patched === null) continue;
      return {
        framework: this.framework,
        diffs: [{ path: rel, unifiedDiff: diffDocuments(source, patched, rel), patched }],
      };
    }
    return null;
  },
};

/** The metadata object field(s) for an issue, or null if not insertable here. */
function metadataFragment(issue: IssueType, instruction: RemediationInstruction): string | null {
  const target = instruction.targetSurfaceChange as Partial<SeoSurface>;
  switch (issue) {
    case "missing_title":
      return `title: ${quote(target.title ?? "Page title")}`;
    case "missing_meta_description":
      return `description: ${quote("A concise, 140–160 character summary of this page.")}`;
    case "missing_canonical":
      return target.canonical ? `alternates: { canonical: ${quote(target.canonical)} }` : null;
    default:
      // Replacements (malformed canonical, noindex) need to edit existing config.
      return null;
  }
}

/**
 * Insert `export const metadata = { <fragment> }` after the file's import block.
 * Returns null if there is no sensible insertion point.
 */
function insertMetadataExport(source: string, fragment: string): string | null {
  const lines = source.split("\n");
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\b/.test(lines[i] ?? "")) insertAt = i + 1;
  }
  // Directive-only files ("use client") still get the export after the directive.
  const block = `\nexport const metadata = {\n  ${fragment},\n};\n`;
  const next = [...lines.slice(0, insertAt), block.replace(/^\n/, ""), ...lines.slice(insertAt)];
  return next.join("\n");
}

function quote(value: string): string {
  return JSON.stringify(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
