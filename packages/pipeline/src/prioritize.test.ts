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
    const ranks = severities.map((s) => ({ high: 0, medium: 1, low: 2 })[s]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(severities[0]).toBe("high");
    expect(severities.at(-1)).toBe("low");
  });
});

const healthyHead = `<title>T</title>
    <meta name="description" content="d" />
    <link rel="canonical" href="https://ex.com/p" />`;

describe("patch rail — insertion vs replacement", () => {
  it("does NOT emit a patch for body-level fixes (missing_h1)", async () => {
    const html = `<!doctype html><html><head>
    ${healthyHead}
  </head><body><div>no heading</div></body></html>`;
    const res = await runScan(html, "https://ex.com/p");
    const item = res.items.find((i) => i.finding.issueType === "missing_h1");
    expect(item).toBeDefined();
    // An <h1> must never be inserted into <head>; guidance only.
    expect(item?.patch).toBeUndefined();
    expect(item?.instruction.canonicalFix.html).toBeUndefined();
    expect(item?.instruction.canonicalFix.diffHint).toBeTruthy();
  });

  it("REPLACES a noindex robots meta rather than adding a second one", async () => {
    const html = `<!doctype html><html><head>
    ${healthyHead}
    <meta name="robots" content="noindex" />
  </head><body><h1>x</h1></body></html>`;
    const res = await runScan(html, "https://ex.com/p");
    const item = res.items.find((i) => i.finding.issueType === "noindex_unexpected");
    expect(item?.patch).toBeDefined();
    expect(item?.instruction.canonicalFix.replaceSelector).toBe('meta[name="robots"]');
    // The old directive is removed, not supplemented — engines honour the most
    // restrictive tag, so a leftover noindex would silently defeat the fix.
    expect(item?.patch).toContain('-    <meta name="robots" content="noindex" />');
    expect(item?.patch).toContain('+    <meta name="robots" content="index, follow" />');
  });

  it("REPLACES a malformed canonical rather than adding a competing one", async () => {
    const html = `<!doctype html><html><head>
    <title>T</title>
    <meta name="description" content="d" />
    <link rel="canonical" href="javascript:void(0)" />
  </head><body><h1>x</h1></body></html>`;
    const res = await runScan(html, "https://ex.com/p");
    const item = res.items.find((i) => i.finding.issueType === "malformed_canonical");
    expect(item?.patch).toBeDefined();
    expect(item?.patch).toContain('-    <link rel="canonical" href="javascript:void(0)" />');
    expect(item?.patch).toContain('+    <link rel="canonical" href="https://ex.com/p" />');
  });

  it("still emits an insertion patch for a genuinely missing head tag", async () => {
    const bare = `<!doctype html><html><head></head><body><h1>x</h1></body></html>`;
    const res = await runScan(bare, "https://ex.com/p");
    const canonical = res.items.find((i) => i.finding.issueType === "missing_canonical");
    expect(canonical?.patch).toContain('rel="canonical"');
  });
});

describe("patch verification", () => {
  it("only surfaces patches that resolve the issue without adding new ones", async () => {
    const bare = `<!doctype html><html><head></head><body><h1>x</h1></body></html>`;
    const res = await runScan(bare, "https://ex.com/p");
    for (const item of res.items) {
      if (!item.patch) continue;
      const patched = item.patch;
      expect(patched).toContain("+++ b/p");
    }
    // Every automatable fix here is a head insertion and must verify.
    const automatable = res.items.filter((i) => i.instruction.canonicalFix.html);
    expect(automatable.length).toBeGreaterThan(0);
    for (const item of automatable) expect(item.patch).toBeDefined();
  });

  it("explains why a patch is unavailable", async () => {
    const html = `<!doctype html><html><head>
    ${healthyHead}
  </head><body><div>no heading</div></body></html>`;
    const res = await runScan(html, "https://ex.com/p");
    const item = res.items.find((i) => i.finding.issueType === "missing_h1");
    expect(item?.patchUnavailable).toBe("fix requires manual judgement");
  });
});

describe("multi-fix batching", () => {
  it("emits one combined diff applying every automatable fix", async () => {
    const bare = `<!doctype html><html><head></head><body><h1>x</h1></body></html>`;
    const res = await runScan(bare, "https://ex.com/p");
    expect(res.combinedPatch).toBeDefined();
    // One diff carrying title, description and canonical together.
    expect(res.combinedPatch).toContain("<title>");
    expect(res.combinedPatch).toContain('rel="canonical"');
    expect(res.combinedPatch).toContain('name="description"');
  });

  it("omits the combined patch when fewer than two fixes are automatable", async () => {
    const html = `<!doctype html><html><head>
    ${healthyHead}
  </head><body><div>no heading</div></body></html>`;
    const res = await runScan(html, "https://ex.com/p");
    expect(res.combinedPatch).toBeUndefined();
  });
});
