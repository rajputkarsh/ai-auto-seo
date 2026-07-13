import { describe, it, expect } from "vitest";
import type { RemediationInstruction, SiteContext } from "@awe/core";
import { patchAdapter } from "./patch";
import { recommendationAdapter } from "./recommendation";

const instruction: RemediationInstruction = {
  finding: { issueType: "missing_canonical", severity: "high", url: "https://ex.com/p", message: "no canonical" },
  whatIsWrong: "no canonical",
  whyItMatters: "duplicate indexing",
  expectedImpact: "High",
  confidence: 0.98,
  targetSurfaceChange: { canonical: "https://ex.com/p" },
  canonicalFix: { html: '<link rel="canonical" href="https://ex.com/p" />' },
};

const html = `<!doctype html>
<html>
  <head>
    <title>P</title>
  </head>
  <body>hi</body>
</html>`;

describe("recommendationAdapter (Policy 1)", () => {
  it("is universal and formats a readable card with confidence + fix", async () => {
    expect(recommendationAdapter.supports({ url: "anything" })).toBe(true);
    const out = await recommendationAdapter.render(instruction, { url: "anything" });
    expect(out.artifact).toContain("Confidence: 98%");
    expect(out.artifact).toContain('rel="canonical"');
  });
});

describe("patchAdapter (Policy 2)", () => {
  it("needs rendered HTML to be applicable", () => {
    expect(patchAdapter.supports({ url: "https://ex.com/p" })).toBe(false);
    expect(patchAdapter.supports({ url: "https://ex.com/p", html })).toBe(true);
  });

  it("produces a unified diff that inserts the fix before </head>", async () => {
    const ctx: SiteContext = { url: "https://ex.com/p", html };
    const out = await patchAdapter.render(instruction, ctx);
    expect(out.artifact).toContain("+++ b/p");
    // The canonical link appears on an added (+) line of the diff.
    expect(out.artifact).toMatch(/\n\+.*rel="canonical" href="https:\/\/ex\.com\/p"/);
    // The patched document actually contains the canonical link inside <head>.
    const patched = String(out.meta?.patched);
    expect(patched).toContain('<link rel="canonical" href="https://ex.com/p" />');
    expect(patched.indexOf("canonical")).toBeLessThan(patched.indexOf("</head>"));
  });

  it("is not applicable when there is no <head> to patch", async () => {
    const out = await patchAdapter.render(instruction, { url: "https://ex.com/p", html: "<div>no head</div>" });
    expect(out.meta?.applicable).toBe(false);
  });
});
