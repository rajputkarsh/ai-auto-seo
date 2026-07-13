import { describe, it, expect } from "vitest";
import type { SeoSurface } from "@awe/core";
import { evaluate } from "./engine";

const healthy = (over: Partial<SeoSurface>): SeoSurface => ({
  url: "https://ex.com/",
  title: "Home | Example",
  description: "The example homepage.",
  canonical: "https://ex.com/",
  h1Count: 1,
  ...over,
});

describe("rules engine", () => {
  it("does NOT flag a healthy page (true negative)", () => {
    expect(evaluate([healthy({ url: "https://ex.com/ok" })])).toHaveLength(0);
  });

  it("flags a missing canonical (true positive)", () => {
    const f = evaluate([healthy({ url: "https://ex.com/a", canonical: null })]);
    expect(f.map((x) => x.issueType)).toEqual(["missing_canonical"]);
    expect(f[0]?.severity).toBe("high");
  });

  it("flags a relative/malformed canonical", () => {
    const f = evaluate([healthy({ url: "https://ex.com/b", canonical: "/b" })]);
    expect(f.map((x) => x.issueType)).toContain("malformed_canonical");
  });

  it("flags missing title and missing meta description together", () => {
    const f = evaluate([healthy({ url: "https://ex.com/c", title: undefined, description: undefined })]);
    const types = f.map((x) => x.issueType);
    expect(types).toContain("missing_title");
    expect(types).toContain("missing_meta_description");
  });

  it("detects duplicate titles across pages in the same scan", () => {
    const f = evaluate([
      healthy({ url: "https://ex.com/1", title: "Same Title" }),
      healthy({ url: "https://ex.com/2", title: "Same Title" }),
    ]);
    expect(f.filter((x) => x.issueType === "duplicate_title")).toHaveLength(2);
  });

  it("does not report duplicate title for a unique title", () => {
    const f = evaluate([
      healthy({ url: "https://ex.com/1", title: "Unique A" }),
      healthy({ url: "https://ex.com/2", title: "Unique B" }),
    ]);
    expect(f.filter((x) => x.issueType === "duplicate_title")).toHaveLength(0);
  });
});
