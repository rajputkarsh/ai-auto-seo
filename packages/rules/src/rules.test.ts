import type { SeoSurface } from "@awe/core";
import { describe, expect, it } from "vitest";
import { evaluate } from "./engine";

const healthy = (over: Partial<SeoSurface>): SeoSurface => ({
  url: "https://ex.com/p",
  title: "Page | Example",
  description: "A description.",
  canonical: "https://ex.com/p",
  h1Count: 1,
  ...over,
});

const types = (s: SeoSurface) => evaluate([s]).map((f) => f.issueType);

describe("robotsRule", () => {
  it("flags an explicit noindex", () => {
    expect(types(healthy({ robots: { index: false, follow: true } }))).toContain(
      "noindex_unexpected",
    );
  });

  it("stays silent when robots is absent (indexable by default)", () => {
    expect(types(healthy({}))).not.toContain("noindex_unexpected");
  });

  it("stays silent on an explicit index directive", () => {
    expect(types(healthy({ robots: { index: true, follow: true } }))).not.toContain(
      "noindex_unexpected",
    );
  });
});

describe("structuredDataRule", () => {
  it("flags an invalid JSON-LD block", () => {
    expect(
      types(healthy({ jsonLd: [{ type: "Unknown", valid: false, errors: ["bad"] }] })),
    ).toContain("invalid_structured_data");
  });

  it("does NOT flag absent structured data — it is optional, not a defect", () => {
    expect(types(healthy({}))).not.toContain("invalid_structured_data");
    expect(types(healthy({ jsonLd: [] }))).not.toContain("missing_structured_data");
  });

  it("stays silent on valid structured data", () => {
    expect(types(healthy({ jsonLd: [{ type: "Product", valid: true }] }))).not.toContain(
      "invalid_structured_data",
    );
  });
});

describe("headingRule", () => {
  it("flags a page with no h1", () => {
    expect(types(healthy({ h1Count: 0 }))).toContain("missing_h1");
  });

  it("flags multiple h1s at low severity", () => {
    const findings = evaluate([healthy({ h1Count: 3 })]);
    const multi = findings.find((f) => f.issueType === "multiple_h1");
    expect(multi).toBeDefined();
    expect(multi?.severity).toBe("low");
  });

  it("stays silent on exactly one h1", () => {
    const t = types(healthy({ h1Count: 1 }));
    expect(t).not.toContain("missing_h1");
    expect(t).not.toContain("multiple_h1");
  });
});

describe("canonicalRule after upstream resolution", () => {
  it("accepts an absolute canonical", () => {
    expect(types(healthy({ canonical: "https://ex.com/p" }))).toHaveLength(0);
  });

  it("flags a canonical that is not usable http(s)", () => {
    expect(types(healthy({ canonical: "javascript:void(0)" }))).toContain("malformed_canonical");
  });
});
