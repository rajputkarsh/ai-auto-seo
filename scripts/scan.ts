/**
 * Demo CLI: run the full universal pipeline against a URL or a local HTML file.
 *
 *   pnpm scan examples/broken-page.html
 *   pnpm scan https://example.com
 *
 * Prints, for each detected issue, the recommendation card and (when patchable)
 * the unified diff. Runs with zero external services.
 */
import { readFile } from "node:fs/promises";
import { runScan } from "@awe/pipeline";

async function loadHtml(target: string): Promise<{ html: string; url: string }> {
  if (/^https?:\/\//i.test(target)) {
    const res = await fetch(target);
    return { html: await res.text(), url: target };
  }
  return { html: await readFile(target, "utf8"), url: "https://example.com/" };
}

const target = process.argv[2];
if (!target) {
  console.error("Usage: pnpm scan <url | file.html>");
  process.exit(1);
}

const { html, url } = await loadHtml(target);
const result = await runScan(html, url);

const s = result.surface;
console.log(`\nScanned ${result.url}`);
console.log(
  `Surface: title=${s.title ?? "—"} | canonical=${s.canonical ?? "—"} | description=${s.description ? "yes" : "—"} | h1=${s.h1Count ?? 0}`,
);
console.log(`\nFound ${result.items.length} issue(s):\n`);

for (const item of result.items) {
  console.log("─".repeat(64));
  console.log(item.recommendation);
  if (item.patch) {
    console.log("\nPatch (unified diff):");
    console.log(item.patch.trimEnd());
  }
}
console.log("─".repeat(64));
