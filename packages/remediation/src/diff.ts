import * as cheerio from "cheerio";
import { createTwoFilesPatch } from "diff";

export interface PatchResult {
  patched: string;
  diff: string;
}

/**
 * Insert a line of HTML immediately before the closing </head> tag.
 *
 * Robust to single-line or multi-line HTML: we locate </head> by string index,
 * splice the insertion (preserving its indentation), and let jsdiff compute the
 * hunks.
 */
export function buildHeadInsertPatch(
  html: string,
  insert: string,
  fileLabel: string,
): PatchResult | null {
  const patched = applyHeadInsert(html, insert);
  if (patched === null) return null;
  return { patched, diff: unifiedDiff(html, patched, fileLabel) };
}

/** The raw insertion, exposed so several fixes can be batched into one document. */
export function applyHeadInsert(html: string, insert: string): string | null {
  const match = html.match(/([ \t]*)<\/head>/i);
  if (!match || match.index === undefined) return null;

  const indent = match[1] ?? "";
  return (
    html.slice(0, match.index) +
    `${indent}${insert}\n${indent}</head>` +
    html.slice(match.index + match[0].length)
  );
}

/**
 * Replace the element matched by `selector` with `replacement`.
 *
 * Uses parse5 source locations (via cheerio) to find the element's exact byte
 * range, so the edit is minimal and precise — no regex over HTML, and the rest
 * of the document is left untouched so the diff stays reviewable.
 */
export function buildReplacePatch(
  html: string,
  selector: string,
  replacement: string,
  fileLabel: string,
): PatchResult | null {
  const patched = applyReplace(html, selector, replacement);
  if (patched === null) return null;
  return { patched, diff: unifiedDiff(html, patched, fileLabel) };
}

/** The raw replacement, exposed for batching. */
export function applyReplace(html: string, selector: string, replacement: string): string | null {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html, { sourceCodeLocationInfo: true } as never);
  } catch {
    return null;
  }

  const element = $(selector).get(0) as unknown as
    | { sourceCodeLocation?: { startOffset?: number; endOffset?: number } }
    | undefined;
  const location = element?.sourceCodeLocation;
  if (
    !location ||
    typeof location.startOffset !== "number" ||
    typeof location.endOffset !== "number"
  ) {
    return null;
  }

  return html.slice(0, location.startOffset) + replacement + html.slice(location.endOffset);
}

/** Unified diff between two whole documents (used for batched, multi-fix patches). */
export function diffDocuments(before: string, after: string, fileLabel: string): string {
  return unifiedDiff(before, after, fileLabel);
}

function unifiedDiff(before: string, after: string, fileLabel: string): string {
  return createTwoFilesPatch(
    `a/${fileLabel}`,
    `b/${fileLabel}`,
    before,
    after,
    undefined,
    undefined,
    { context: 3 },
  );
}

/** Turn a page URL into a plausible file label for a diff header. */
export function fileLabelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" || u.pathname === "" ? "/index.html" : u.pathname;
    return path.replace(/^\//, "");
  } catch {
    return "page.html";
  }
}
