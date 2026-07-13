import { describe, it, expect } from "vitest";
import type { Finding, SeoSurface } from "@awe/core";
import { deterministicReasoner } from "./reason";

const surface: SeoSurface = { url: "https://ex.com/blog/my-post", canonical: null };

const finding = (over: Partial<Finding>): Finding => ({
  issueType: "missing_canonical",
  severity: "high",
  url: surface.url,
  message: "missing",
  ...over,
});

describe("deterministicReasoner", () => {
  it("targets the page URL for a missing canonical and emits fix HTML", () => {
    const ins = deterministicReasoner.reason(finding({ issueType: "missing_canonical" }), surface);
    expect(ins.targetSurfaceChange.canonical).toBe("https://ex.com/blog/my-post");
    expect(ins.canonicalFix.html).toContain('rel="canonical"');
    expect(ins.confidence).toBeGreaterThan(0.9);
    expect(ins.expectedImpact).toBe("High");
  });

  it("suggests a title derived from the URL slug", () => {
    const ins = deterministicReasoner.reason(
      finding({ issueType: "missing_title", message: "no title" }),
      surface,
    );
    expect(ins.canonicalFix.html).toBe("<title>My Post</title>");
  });

  it("always fills why/impact/confidence for any finding", () => {
    const ins = deterministicReasoner.reason(finding({ issueType: "duplicate_title", severity: "medium" }), surface);
    expect(ins.whyItMatters.length).toBeGreaterThan(0);
    expect(ins.expectedImpact).toBe("Medium");
    expect(ins.confidence).toBeGreaterThan(0);
  });
});
