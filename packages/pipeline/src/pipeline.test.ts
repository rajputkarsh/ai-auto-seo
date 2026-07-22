import { describe, expect, it } from "vitest";
import { runScan } from "./pipeline";

const brokenPage = `<!doctype html>
<html>
  <head>
  </head>
  <body><h1>Hi</h1></body>
</html>`;

describe("runScan (end-to-end pipeline)", () => {
  it("detects issues and produces recommendations + a patch", async () => {
    const res = await runScan(brokenPage, "https://ex.com/page");
    const types = res.items.map((i) => i.finding.issueType);
    expect(types).toContain("missing_title");
    expect(types).toContain("missing_meta_description");
    expect(types).toContain("missing_canonical");

    const canonical = res.items.find((i) => i.finding.issueType === "missing_canonical");
    expect(canonical?.recommendation).toContain("Confidence");
    expect(canonical?.patch).toContain('rel="canonical"');
  });

  it("returns no items for a healthy page", async () => {
    const healthy = `<!doctype html><html><head>
      <title>Good Page</title>
      <meta name="description" content="A good page." />
      <link rel="canonical" href="https://ex.com/good" />
    </head><body><h1>Good</h1></body></html>`;
    const res = await runScan(healthy, "https://ex.com/good");
    expect(res.items).toHaveLength(0);
  });
});
