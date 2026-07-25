import type { SourcePatch } from "@awe/adapters";
import type { IssueType } from "@awe/core";
import { describe, expect, it } from "vitest";
import { runBuildGate } from "./gate";

const BROKEN = `<!doctype html><html><head><title>T</title></head><body><h1>x</h1></body></html>`;
const FIXED = `<!doctype html><html><head><title>T</title><link rel="canonical" href="https://x.com/"></head><body><h1>x</h1></body></html>`;

const htmlPatch = (patched: string): SourcePatch => ({
  framework: "static-html",
  diffs: [{ path: "index.html", unifiedDiff: "…", patched }],
});

const opts = (over: Partial<Parameters<typeof runBuildGate>[1]> = {}) => ({
  issueType: "missing_canonical" as IssueType,
  url: "https://x.com/",
  ...over,
});

describe("runBuildGate — surface verification", () => {
  it("passes a patch that resolves the issue", async () => {
    const verdict = await runBuildGate(htmlPatch(FIXED), opts());
    expect(verdict.passed).toBe(true);
  });

  it("fails a patch that did NOT resolve the issue", async () => {
    const verdict = await runBuildGate(htmlPatch(BROKEN), opts());
    expect(verdict).toEqual(expect.objectContaining({ passed: false, reason: "not_resolved" }));
  });

  it("fails when the patch introduces a new issue type", async () => {
    // Fixes canonical but removes the title, introducing missing_title.
    const introduces = `<!doctype html><html><head><link rel="canonical" href="https://x.com/"></head><body><h1>x</h1></body></html>`;
    const verdict = await runBuildGate(
      htmlPatch(introduces),
      opts({ baseline: new Set<IssueType>(["missing_canonical"]) }),
    );
    expect(verdict).toEqual(expect.objectContaining({ passed: false, reason: "new_issue" }));
  });

  it("allows pre-existing issues through (only NEW ones fail)", async () => {
    // The page still lacks a description, but that was in the baseline.
    const verdict = await runBuildGate(
      htmlPatch(FIXED),
      opts({ baseline: new Set<IssueType>(["missing_canonical", "missing_meta_description"]) }),
    );
    expect(verdict.passed).toBe(true);
  });
});

describe("runBuildGate — build step", () => {
  it("fails a patch whose build fails, without checking the surface", async () => {
    const verdict = await runBuildGate(htmlPatch(FIXED), {
      ...opts(),
      build: async () => ({ ok: false, log: "tsc error" }),
    });
    expect(verdict).toEqual(
      expect.objectContaining({ passed: false, reason: "build_failed", detail: "tsc error" }),
    );
  });

  it("runs the build before the surface check", async () => {
    const order: string[] = [];
    const verdict = await runBuildGate(htmlPatch(FIXED), {
      ...opts(),
      build: async () => {
        order.push("build");
        return { ok: true };
      },
      renderedOutput: (p) => {
        order.push("surface");
        return p.diffs[0]?.patched ?? null;
      },
    });
    expect(verdict.passed).toBe(true);
    expect(order).toEqual(["build", "surface"]);
  });
});

describe("runBuildGate — framework patches with no extractable output", () => {
  const tsxPatch: SourcePatch = {
    framework: "nextjs",
    diffs: [{ path: "app/page.tsx", unifiedDiff: "…", patched: "export const metadata = {}" }],
  };

  it("passes on a successful build (build is the only signal available)", async () => {
    const verdict = await runBuildGate(tsxPatch, { ...opts(), build: async () => ({ ok: true }) });
    expect(verdict.passed).toBe(true);
  });

  it("fails closed when neither a build nor extractable output can verify it", async () => {
    const verdict = await runBuildGate(tsxPatch, opts());
    expect(verdict).toEqual(
      expect.objectContaining({ passed: false, reason: "no_verifiable_output" }),
    );
  });
});
