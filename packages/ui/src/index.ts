/**
 * Server-rendered HTML helpers.
 *
 * These are intentionally tiny and dependency-free. The dashboard and admin
 * console in Phase 2 are runnable surfaces over the real data layer, not the
 * full Next.js apps described in the Customer_Dashboard / Superadmin docs —
 * they exist so the API's data can be seen and driven end-to-end today.
 */

/** Escape untrusted text for safe interpolation into HTML. */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A tagged template that escapes every interpolated value by default. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc, str, i) => {
    if (i === 0) return str;
    const value = values[i - 1];
    // A Raw wrapper opts a value out of escaping (already-safe HTML fragments).
    const rendered = value instanceof Raw ? value.value : esc(value);
    return acc + rendered + str;
  }, "");
}

/** Marks a string as already-safe HTML so `html` won't re-escape it. */
export class Raw {
  constructor(public readonly value: string) {}
}
export function raw(value: string): Raw {
  return new Raw(value);
}

export interface PageOptions {
  title: string;
  accent?: string;
  body: string;
}

/** Wrap body content in a minimal, self-contained page shell. */
export function page({ title, accent = "#2563eb", body }: PageOptions): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         margin: 0; padding: 2rem; max-width: 960px; margin-inline: auto; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  a { color: ${accent}; }
  header { border-bottom: 2px solid ${accent}; padding-bottom: .5rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: baseline; }
  .badge { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .8rem; background: ${accent}22; color: ${accent}; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #8884; font-size: .9rem; }
  input, button, select { font: inherit; padding: .4rem .6rem; border-radius: 6px; border: 1px solid #8886; }
  button { background: ${accent}; color: white; border: none; cursor: pointer; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 1rem; margin: .75rem 0; }
  .reg { color: #dc2626; font-weight: 600; }
  .muted { color: #8889; font-size: .85rem; }
  code { background: #8882; padding: .1rem .3rem; border-radius: 4px; }
</style></head>
<body>${body}</body></html>`;
}
