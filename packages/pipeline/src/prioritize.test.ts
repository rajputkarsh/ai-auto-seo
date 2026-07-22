import { describe, expect, it } from "vitest";
import { runScan } from "./pipeline";

describe("prioritization", () => {
  it("orders findings high → medium → low", async () => {
    // No title/description/canonical (high+medium) and three h1s (low).
    const html = `<!doctype html><html><head></head><body>
      <h1>a</h1><h1>b</h1><h1>c</h1>
    </body></html>`;
    const res = await runScan(html, "https://ex.com/p");
    const severities = res.items.map((i) => i.finding.severity);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const ranks = severities.map((s) => rank[s]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(severities[0]).toBe("high");
    expect(severities.at(-1)).toBe("low");
  });
});

describe("patch rail safety", () => {
  const html = `<!doctype html><html><head>
    <title>T</title>
    <meta name="description" content="d" />
    <link rel="canonical" href="https://ex.com/p" />
  </head><body><div>no heading</div></body></html>`;

  it("does NOT emit a head patch for body-level fixes (missing_h1)", async () => {
    const res = await runScan(html, "https://ex.com/p");
    const h1Item = res.items.find((i) => i.finding.issueType === "missing_h1");
    expect(h1Item).toBeDefined();
    // An <h1> must never be inserted into <head>; guidance only.
    expect(h1Item?.patch).toBeUndefined();
    expect(h1Item?.instruction.canonicalFix.html).toBeUndefined();
    expect(h1Item?.instruction.canonicalFix.diffHint).toBeTruthy();
  });

  it("does NOT emit a head patch for noindex (needs replacement, not insertion)", async () => {
    const noindex = `<!doctype html><html><head>
      <title>T</title>
      <meta name="description" content="d" />
      <link rel="canonical" href="https://ex.com/p" />
      <meta name="robots" content="noindex" />
    </head><body><h1>x</h1></body></html>`;
    const res = await runScan(noindex, "https://ex.com/p");
    const item = res.items.find((i) => i.finding.issueType === "noindex_unexpected");
    expect(item).toBeDefined();
    expect(item?.patch).toBeUndefined();
    expect(item?.instruction.canonicalFix.diffHint).toMatch(/replace/i);
  });

  it("still emits a patch for genuine head insertions", async () => {
    const bare = `<!doctype html><html><head></head><body><h1>x</h1></body></html>`;
    const res = await runScan(bare, "https://ex.com/p");
    const canonical = res.items.find((i) => i.finding.issueType === "missing_canonical");
    expect(canonical?.patch).toContain('rel="canonical"');
  });
});
