import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staticHtmlAdapter } from "@awe/adapters";
import type { RemediationInstruction } from "@awe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyRepoRail } from "./apply";
import { InMemoryPrOutcomeStore } from "./outcomes";
import { InMemoryVcsProvider } from "./provider";

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "awe-apply-"));
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

const REPO_REF = { fullName: "acme/site", defaultBranch: "main" };

const instruction = (
  issueType: string,
  over: Partial<RemediationInstruction> = {},
): RemediationInstruction => ({
  finding: {
    issueType: issueType as RemediationInstruction["finding"]["issueType"],
    severity: "high",
    url: "https://acme.com/",
    route: "/",
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

// Genuinely healthy except the missing canonical, so fixing it leaves a clean
// page — the gate only passes when no NEW issue appears.
const HEALTHY_EXCEPT = `<!doctype html><html><head>
  <title>Home | Acme</title>
  <meta name="description" content="The Acme homepage.">
</head><body><h1>Home</h1></body></html>`;

describe("applyRepoRail", () => {
  it("opens a PR for the automatable finding and falls back for the rest", async () => {
    await writeFile(join(repo, "index.html"), HEALTHY_EXCEPT);
    const vcs = new InMemoryVcsProvider();
    const outcomes = new InMemoryPrOutcomeStore();

    const summary = await applyRepoRail(
      [
        instruction("missing_canonical", {
          targetSurfaceChange: { canonical: "https://acme.com/" },
          canonicalFix: { html: '<link rel="canonical" href="https://acme.com/" />' },
        }),
        // Body-level fix the source rail can't own → fallback.
        instruction("missing_h1", { canonicalFix: { diffHint: "add an h1" } }),
      ],
      {
        orgId: "acme",
        repo: REPO_REF,
        repoRoot: repo,
        baseline: new Set(["missing_canonical", "missing_h1"]),
      },
      { adapter: staticHtmlAdapter, vcs, outcomes },
    );

    expect(summary.prsOpened).toBe(1);
    expect(summary.fellBack).toBe(1);

    const pr = summary.items.find((i) => i.issueType === "missing_canonical");
    expect(pr?.outcome.rail).toBe("repo_pr");
    const h1 = summary.items.find((i) => i.issueType === "missing_h1");
    expect(h1?.outcome).toEqual({ rail: "fallback", reason: "adapter_declined" });

    // The opened PR is recorded for merge-rate tracking.
    expect(vcs.opened).toHaveLength(1);
    expect((await outcomes.mergeRate("acme")).opened).toBe(1);
  });

  it("one finding's failure never blocks another", async () => {
    await writeFile(join(repo, "index.html"), HEALTHY_EXCEPT);
    const vcs = new InMemoryVcsProvider();

    const summary = await applyRepoRail(
      [
        // Gate will fail this one (build reports failure)...
        instruction("missing_canonical", {
          targetSurfaceChange: { canonical: "https://acme.com/" },
          canonicalFix: { html: '<link rel="canonical" href="https://acme.com/" />' },
        }),
      ],
      { orgId: "acme", repo: REPO_REF, repoRoot: repo },
      { adapter: staticHtmlAdapter, vcs, build: async () => ({ ok: false, log: "x" }) },
    );

    expect(summary.prsOpened).toBe(0);
    expect(summary.items[0]?.outcome).toEqual({ rail: "fallback", reason: "build_failed" });
    expect(vcs.opened).toHaveLength(0); // no build-breaking PR opened
  });

  it("records merge-rate as PRs get resolved", async () => {
    await writeFile(join(repo, "index.html"), HEALTHY_EXCEPT);
    const vcs = new InMemoryVcsProvider();
    const outcomes = new InMemoryPrOutcomeStore();

    await applyRepoRail(
      [
        instruction("missing_canonical", {
          targetSurfaceChange: { canonical: "https://acme.com/" },
          canonicalFix: { html: '<link rel="canonical" href="https://acme.com/" />' },
        }),
      ],
      { orgId: "acme", repo: REPO_REF, repoRoot: repo, baseline: new Set(["missing_canonical"]) },
      { adapter: staticHtmlAdapter, vcs, outcomes },
    );

    const [pr] = await outcomes.list("acme");
    if (pr) await outcomes.resolve(pr.id, "merged_unedited");
    expect((await outcomes.mergeRate("acme")).mergeRateWithoutEdits).toBe(1);
  });
});
