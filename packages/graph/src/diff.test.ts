import type { Finding, SeoSurface } from "@awe/core";
import { describe, expect, it } from "vitest";
import { diffSurfaces } from "./diff";
import { mergeFindings } from "./merge";

const base = (over: Partial<SeoSurface> = {}): SeoSurface => ({
  url: "https://ex.com/p",
  status: 200,
  title: "Page | Example",
  description: "A description.",
  canonical: "https://ex.com/p",
  h1Count: 1,
  ...over,
});

const types = (previous: SeoSurface, current: SeoSurface) =>
  diffSurfaces(previous, current).map((f) => f.issueType);

describe("diffSurfaces — negative deltas only", () => {
  it("reports nothing when nothing changed", () => {
    expect(diffSurfaces(base(), base())).toHaveLength(0);
  });

  it("does NOT report an intentional title change", () => {
    // Rewriting a title is normal editorial work, not a regression.
    expect(types(base({ title: "Old" }), base({ title: "New" }))).toHaveLength(0);
  });

  it("does NOT report a changed canonical target", () => {
    expect(
      types(base({ canonical: "https://ex.com/a" }), base({ canonical: "https://ex.com/b" })),
    ).toHaveLength(0);
  });

  it("does NOT report an issue that was already broken (not a regression)", () => {
    // Absent in both scans — a long-standing issue for the normal rules.
    expect(types(base({ title: undefined }), base({ title: undefined }))).toHaveLength(0);
  });
});

describe("diffSurfaces — real regressions", () => {
  it("flags a title that disappeared", () => {
    const findings = diffSurfaces(base({ title: "Old" }), base({ title: undefined }));
    expect(findings[0]?.issueType).toBe("missing_title");
    expect(findings[0]?.isRegression).toBe(true);
    expect(findings[0]?.before).toBe("Old");
    expect(findings[0]?.after).toBeNull();
  });

  it("flags newly introduced noindex", () => {
    const findings = diffSurfaces(
      base({ robots: { index: true, follow: true } }),
      base({ robots: { index: false, follow: true } }),
    );
    expect(findings[0]?.issueType).toBe("noindex_unexpected");
    expect(findings[0]?.severity).toBe("high");
  });

  it("treats a previously-absent robots meta as indexable", () => {
    // No robots tag means indexable, so adding noindex is still a regression.
    expect(types(base(), base({ robots: { index: false, follow: true } }))).toContain(
      "noindex_unexpected",
    );
  });

  it("flags a page that stopped resolving", () => {
    const findings = diffSurfaces(base({ status: 200 }), base({ status: 404 }));
    expect(findings[0]?.issueType).toBe("page_unavailable");
    expect(findings[0]?.before).toBe(200);
    expect(findings[0]?.after).toBe(404);
  });

  it("does not flag a status change between two healthy codes", () => {
    expect(types(base({ status: 200 }), base({ status: 204 }))).toHaveLength(0);
  });

  it("flags a removed canonical, description, and h1", () => {
    expect(types(base(), base({ canonical: null }))).toContain("missing_canonical");
    expect(types(base(), base({ description: undefined }))).toContain("missing_meta_description");
    expect(types(base(), base({ h1Count: 0 }))).toContain("missing_h1");
  });

  it("distinguishes structured data removed from structured data broken", () => {
    const withValid = base({ jsonLd: [{ type: "Product", valid: true }] });
    expect(types(withValid, base({ jsonLd: [] }))).toContain("missing_structured_data");
    expect(types(withValid, base({ jsonLd: [{ type: "Unknown", valid: false }] }))).toContain(
      "invalid_structured_data",
    );
  });

  it("flags a sitemap that disappeared", () => {
    const before = base({ siteWide: { robotsTxtPresent: true, sitemapPresent: true } });
    const after = base({ siteWide: { robotsTxtPresent: true, sitemapPresent: false } });
    expect(types(before, after)).toContain("sitemap_missing");
  });
});

describe("mergeFindings", () => {
  const ruleFinding: Finding = {
    issueType: "missing_title",
    severity: "high",
    url: "https://ex.com/p",
    message: "Page has no <title>.",
  };
  const regression: Finding = {
    issueType: "missing_title",
    severity: "high",
    url: "https://ex.com/p",
    message: "Page had a <title> and now has none.",
    isRegression: true,
    before: "Old",
    after: null,
  };

  it("does not duplicate an issue reported by both sources", () => {
    const merged = mergeFindings([ruleFinding], [regression]);
    expect(merged).toHaveLength(1);
  });

  it("promotes the shared issue to a regression with before/after", () => {
    const merged = mergeFindings([ruleFinding], [regression]);
    expect(merged[0]?.isRegression).toBe(true);
    expect(merged[0]?.before).toBe("Old");
  });

  it("keeps issues unique to either source", () => {
    const other: Finding = { ...ruleFinding, issueType: "missing_canonical" };
    const merged = mergeFindings([other], [regression]);
    expect(merged.map((f) => f.issueType).sort()).toEqual(["missing_canonical", "missing_title"]);
  });

  it("keys by URL so different pages do not collide", () => {
    const otherPage: Finding = { ...ruleFinding, url: "https://ex.com/other" };
    expect(mergeFindings([ruleFinding, otherPage], [])).toHaveLength(2);
  });
});
