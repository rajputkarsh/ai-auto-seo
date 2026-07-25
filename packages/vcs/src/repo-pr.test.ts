import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staticHtmlAdapter } from "@awe/adapters";
import type { RemediationInstruction } from "@awe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryVcsProvider } from "./provider";
import { openRepoPr } from "./repo-pr";

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "awe-pr-"));
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

const REPO_REF = { fullName: "acme/site", defaultBranch: "main" };

const missingCanonical: RemediationInstruction = {
  finding: {
    issueType: "missing_canonical",
    severity: "high",
    url: "https://acme.com/",
    route: "/",
    message: "no canonical",
  },
  whatIsWrong: "Page is missing a canonical URL.",
  whyItMatters: "Duplicate URLs may be indexed.",
  expectedImpact: "High",
  confidence: 0.98,
  targetSurfaceChange: { canonical: "https://acme.com/" },
  canonicalFix: { html: '<link rel="canonical" href="https://acme.com/" />' },
};

const HEALTHY_EXCEPT_CANONICAL = `<!doctype html><html><head>
  <title>Home | Acme</title>
  <meta name="description" content="Acme homepage.">
</head><body><h1>Home</h1></body></html>`;

describe("openRepoPr — happy path", () => {
  it("opens a verified PR for a static-HTML fix", async () => {
    await writeFile(join(repo, "index.html"), HEALTHY_EXCEPT_CANONICAL);
    const vcs = new InMemoryVcsProvider();

    const outcome = await openRepoPr(
      {
        instruction: missingCanonical,
        repo: REPO_REF,
        repoRoot: repo,
        route: "/",
        baseline: new Set(["missing_canonical"]),
      },
      { adapter: staticHtmlAdapter, vcs },
    );

    expect(outcome.status).toBe("opened");
    expect(vcs.opened).toHaveLength(1);

    const pr = vcs.opened[0];
    expect(pr?.repo.fullName).toBe("acme/site");
    expect(pr?.branch).toMatch(/^awe\/missing-canonical-/);
    expect(pr?.title).toContain("missing canonical");
    expect(pr?.body).toContain("**Confidence:** 98%");
    // The committed file actually contains the fix.
    expect(pr?.patch.diffs[0]?.patched).toContain('rel="canonical"');
  });
});

describe("openRepoPr — fallbacks (never degrade below the universal rail)", () => {
  it("falls back when the route maps to no file", async () => {
    const outcome = await openRepoPr(
      { instruction: missingCanonical, repo: REPO_REF, repoRoot: repo, route: "/nonexistent" },
      { adapter: staticHtmlAdapter, vcs: new InMemoryVcsProvider() },
    );
    expect(outcome).toEqual({ status: "fallback", reason: "unmappable" });
  });

  it("falls back when the adapter declines (body-level fix)", async () => {
    await writeFile(join(repo, "index.html"), HEALTHY_EXCEPT_CANONICAL);
    const guidanceOnly: RemediationInstruction = {
      ...missingCanonical,
      finding: { ...missingCanonical.finding, issueType: "missing_h1" },
      canonicalFix: { diffHint: "add an h1" },
    };
    const outcome = await openRepoPr(
      { instruction: guidanceOnly, repo: REPO_REF, repoRoot: repo, route: "/" },
      { adapter: staticHtmlAdapter, vcs: new InMemoryVcsProvider() },
    );
    expect(outcome).toEqual({ status: "fallback", reason: "adapter_declined" });
  });

  it("falls back — and opens no PR — when the build gate fails the patch", async () => {
    await writeFile(join(repo, "index.html"), HEALTHY_EXCEPT_CANONICAL);
    const vcs = new InMemoryVcsProvider();
    const outcome = await openRepoPr(
      { instruction: missingCanonical, repo: REPO_REF, repoRoot: repo, route: "/" },
      { adapter: staticHtmlAdapter, vcs, build: async () => ({ ok: false, log: "boom" }) },
    );
    expect(outcome).toEqual({ status: "fallback", reason: "build_failed" });
    expect(vcs.opened).toHaveLength(0); // no build-breaking PR ever reaches a customer
  });
});
