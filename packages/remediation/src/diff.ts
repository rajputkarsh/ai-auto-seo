import { createTwoFilesPatch } from "diff";

/**
 * Insert a line of HTML immediately before the closing </head> tag and return
 * both the patched document and a standard unified diff.
 *
 * Robust to single-line or multi-line HTML: we locate </head> by string index,
 * splice the insertion, and let jsdiff compute the hunks.
 */
export function buildHeadInsertPatch(
  html: string,
  insert: string,
  fileLabel: string,
): { patched: string; diff: string } | null {
  const match = html.match(/([ \t]*)<\/head>/i);
  if (!match || match.index === undefined) return null;

  const indent = match[1] ?? "";
  const patched =
    html.slice(0, match.index) +
    `${indent}${insert}\n${indent}</head>` +
    html.slice(match.index + match[0].length);
  const diff = createTwoFilesPatch(
    `a/${fileLabel}`,
    `b/${fileLabel}`,
    html,
    patched,
    undefined,
    undefined,
    { context: 3 },
  );
  return { patched, diff };
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
