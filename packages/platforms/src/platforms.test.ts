import type { RemediationInstruction } from "@awe/core";
import { extractSurface } from "@awe/extractor";
import { describe, expect, it } from "vitest";
import { fieldWriteFor } from "./adapter";
import { applyCmsRail } from "./cms-rail";
import { InMemoryPlatform } from "./in-memory";
import { InMemoryCmsOutcomeStore } from "./outcomes";
import { payloadFor, WordPressPlatform } from "./wordpress";

const instruction = (
  issueType: string,
  over: Partial<RemediationInstruction> = {},
): RemediationInstruction => ({
  finding: {
    issueType: issueType as RemediationInstruction["finding"]["issueType"],
    severity: "high",
    url: "https://ex.com/pricing",
    message: "",
  },
  whatIsWrong: "",
  whyItMatters: "",
  expectedImpact: "High",
  confidence: 0.95,
  targetSurfaceChange: {},
  canonicalFix: {},
  ...over,
});

describe("fieldWriteFor", () => {
  it("maps writable issues to a field + value", () => {
    expect(
      fieldWriteFor(instruction("missing_title", { targetSurfaceChange: { title: "T" } })),
    ).toEqual({ kind: "title", value: "T" });
    expect(
      fieldWriteFor(
        instruction("missing_canonical", {
          targetSurfaceChange: { canonical: "https://ex.com/p" },
        }),
      ),
    ).toEqual({ kind: "canonical", value: "https://ex.com/p" });
    expect(fieldWriteFor(instruction("noindex_unexpected"))).toEqual({
      kind: "robots",
      value: "index, follow",
    });
  });

  it("returns null for a fix the CMS rail can't own", () => {
    expect(fieldWriteFor(instruction("invalid_structured_data"))).toBeNull();
    expect(fieldWriteFor(instruction("missing_h1"))).toBeNull();
    // canonical with no target value can't be written.
    expect(fieldWriteFor(instruction("missing_canonical"))).toBeNull();
  });
});

describe("WordPress adapter (request shapes, injectable fetch)", () => {
  it("maps fields onto the right REST payload", () => {
    expect(payloadFor({ kind: "title", value: "Home" })).toEqual({ title: "Home" });
    expect(payloadFor({ kind: "description", value: "d" })).toEqual({
      meta: { _yoast_wpseo_metadesc: "d" },
    });
    expect(payloadFor({ kind: "canonical", value: "https://x/" })).toEqual({
      meta: { _yoast_wpseo_canonical: "https://x/" },
    });
  });

  it("resolves an entry by slug, trying pages then posts", async () => {
    const calls: string[] = [];
    const wp = new WordPressPlatform({
      baseUrl: "https://blog.example.com",
      authHeader: "Basic xxx",
      fetchImpl: (async (url: string) => {
        calls.push(url);
        // pages: miss; posts: hit.
        const body = url.includes("/pages")
          ? []
          : [{ id: 42, link: "https://blog.example.com/hello" }];
        return { ok: true, json: async () => body } as Response;
      }) as typeof fetch,
    });

    const entry = await wp.resolveEntry("https://blog.example.com/hello");
    expect(entry).toEqual({ entryId: "42", type: "posts" });
    expect(calls[0]).toContain("/wp-json/wp/v2/pages?slug=hello");
    expect(calls[1]).toContain("/wp-json/wp/v2/posts?slug=hello");
  });

  it("PATCHes the mapped field to the entry", async () => {
    let patched: { url: string; body: unknown; auth: unknown } | undefined;
    const wp = new WordPressPlatform({
      baseUrl: "https://blog.example.com",
      authHeader: "Basic secret",
      fetchImpl: (async (url: string, init: RequestInit) => {
        patched = {
          url,
          body: JSON.parse(String(init.body)),
          auth: (init.headers as Record<string, string>).authorization,
        };
        return { ok: true, json: async () => ({}) } as Response;
      }) as typeof fetch,
    });

    const result = await wp.writeField(
      { entryId: "42", type: "posts" },
      { kind: "title", value: "New Title" },
      { draft: true },
    );
    expect(patched?.url).toContain("/wp-json/wp/v2/posts/42");
    expect(patched?.body).toEqual({ title: "New Title" });
    expect(patched?.auth).toBe("Basic secret");
    expect(result.reviewUrl).toContain("/wp-admin/post.php?post=42");
  });
});

describe("InMemoryPlatform — draft / publish / verify", () => {
  it("stages a draft without touching the live entry, then publishes", async () => {
    const cms = new InMemoryPlatform();
    cms.seed("https://ex.com/pricing", {
      entryId: "p1",
      type: "page",
      live: { canonical: undefined },
    });

    const entry = await cms.resolveEntry("https://ex.com/pricing");
    expect(entry).toEqual({ entryId: "p1", type: "page" });

    await cms.writeField(
      entry!,
      { kind: "canonical", value: "https://ex.com/pricing" },
      { draft: true },
    );
    // Live entry unchanged; the change is staged.
    expect(cms.liveField("https://ex.com/pricing", "canonical")).toBeUndefined();
    expect(cms.draftFor("p1")?.canonical).toBe("https://ex.com/pricing");

    cms.publish("p1");
    expect(cms.liveField("https://ex.com/pricing", "canonical")).toBe("https://ex.com/pricing");
  });
});

describe("applyCmsRail", () => {
  const setup = () => {
    const cms = new InMemoryPlatform();
    cms.seed("https://ex.com/pricing", { entryId: "p1", type: "page" });
    return { cms, outcomes: new InMemoryCmsOutcomeStore() };
  };

  it("drafts writable fixes and falls back for the rest", async () => {
    const { cms, outcomes } = setup();
    const summary = await applyCmsRail(
      [
        instruction("missing_canonical", {
          targetSurfaceChange: { canonical: "https://ex.com/pricing" },
        }),
        instruction("missing_h1"), // not a CMS field
      ],
      { orgId: "acme", connectionId: "c1", url: "https://ex.com/pricing" },
      { adapter: cms, outcomes },
    );

    expect(summary.drafted).toBe(1);
    expect(summary.fellBack).toBe(1);
    const canonical = summary.items.find((i) => i.issueType === "missing_canonical");
    expect(canonical?.outcome).toEqual(expect.objectContaining({ rail: "cms", kind: "canonical" }));
    expect(summary.items.find((i) => i.issueType === "missing_h1")?.outcome).toEqual({
      rail: "fallback",
      reason: "unwritable_field",
    });

    // Draft-by-default: nothing published, one outcome recorded.
    expect(cms.liveField("https://ex.com/pricing", "canonical")).toBeUndefined();
    expect((await outcomes.appliedFixRate("acme")).drafted).toBe(1);
  });

  it("falls back when the URL maps to no entry", async () => {
    const { cms } = setup();
    const summary = await applyCmsRail(
      [
        instruction("missing_canonical", {
          finding: {
            issueType: "missing_canonical",
            severity: "high",
            url: "https://ex.com/unknown",
            message: "",
          },
          targetSurfaceChange: { canonical: "https://ex.com/unknown" },
        }),
      ],
      { orgId: "acme", connectionId: "c1", url: "https://ex.com/unknown" },
      { adapter: cms },
    );
    expect(summary.items[0]?.outcome).toEqual({ rail: "fallback", reason: "unresolvable_entry" });
  });

  it("verification: a published draft resolves the issue on re-scan", async () => {
    const { cms, outcomes } = setup();
    await applyCmsRail(
      [
        instruction("missing_canonical", {
          targetSurfaceChange: { canonical: "https://ex.com/pricing" },
        }),
      ],
      { orgId: "acme", connectionId: "c1", url: "https://ex.com/pricing" },
      { adapter: cms, outcomes },
    );
    cms.publish("p1");

    // Simulate the re-scan: the live field now feeds a page whose surface is clean.
    const canonical = cms.liveField("https://ex.com/pricing", "canonical");
    const html = `<html><head><link rel="canonical" href="${canonical}"></head><body></body></html>`;
    expect(extractSurface(html, "https://ex.com/pricing").canonical).toBe("https://ex.com/pricing");

    const [outcome] = await outcomes.list("acme");
    if (outcome) await outcomes.resolve(outcome.id, "applied");
    expect((await outcomes.appliedFixRate("acme")).appliedFixRate).toBe(1);
  });
});
