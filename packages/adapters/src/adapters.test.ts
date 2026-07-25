import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemediationInstruction } from "@awe/core";
import { extractSurface } from "@awe/extractor";
import { evaluate } from "@awe/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextjsAdapter } from "./nextjs";
import { detectFramework } from "./registry";
import { staticHtmlAdapter } from "./static-html";

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "awe-repo-"));
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = join(repo, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content);
}

const instruction = (over: Partial<RemediationInstruction>): RemediationInstruction => ({
  finding: { issueType: "missing_canonical", severity: "high", url: "https://x.com/", message: "" },
  whatIsWrong: "",
  whyItMatters: "",
  expectedImpact: "High",
  confidence: 0.9,
  targetSurfaceChange: {},
  canonicalFix: {},
  ...over,
});

describe("detectFramework", () => {
  it("recognises a static site by index.html", async () => {
    await write("index.html", "<html></html>");
    expect((await detectFramework(repo))?.framework).toBe("static-html");
  });

  it("recognises a Next.js repo by its package.json", async () => {
    await write("package.json", JSON.stringify({ dependencies: { next: "15.0.0" } }));
    await write("app/page.tsx", "export default function Page(){return null}");
    expect((await detectFramework(repo))?.framework).toBe("nextjs");
  });

  it("returns null for an unrecognised repo", async () => {
    await write("main.py", "print('hi')");
    expect(await detectFramework(repo)).toBeNull();
  });
});

describe("staticHtmlAdapter", () => {
  const HTML = `<!doctype html>
<html><head>
  <title>Home</title>
</head><body><h1>Home</h1></body></html>`;

  it("maps a route to its file", async () => {
    await write("about.html", HTML);
    await write("index.html", HTML);
    expect(await staticHtmlAdapter.mapRoute("/about", repo)).toEqual(["about.html"]);
    expect(await staticHtmlAdapter.mapRoute("/", repo)).toEqual(["index.html"]);
  });

  it("produces a real, applied source patch that resolves the issue", async () => {
    await write("index.html", HTML);
    const ctx = { repoRoot: repo, route: "/", files: ["index.html"] };
    const patch = await staticHtmlAdapter.applyToSource(
      instruction({
        finding: {
          issueType: "missing_canonical",
          severity: "high",
          url: "https://x.com/",
          message: "",
        },
        canonicalFix: { html: '<link rel="canonical" href="https://x.com/" />' },
        targetSurfaceChange: { canonical: "https://x.com/" },
      }),
      ctx,
    );

    expect(patch).not.toBeNull();
    const diff = patch?.diffs[0];
    expect(diff?.path).toBe("index.html");
    expect(diff?.unifiedDiff).toMatch(/\n\+.*rel="canonical" href="https:\/\/x\.com\/"/);

    // The patched content, re-extracted, no longer has the canonical issue.
    const surface = extractSurface(diff?.patched ?? "", "https://x.com/");
    expect(surface.canonical).toBe("https://x.com/");
    expect(evaluate([surface]).map((f) => f.issueType)).not.toContain("missing_canonical");
  });

  it("returns null for a body-level fix it cannot own", async () => {
    await write("index.html", HTML);
    const patch = await staticHtmlAdapter.applyToSource(
      instruction({
        finding: { issueType: "missing_h1", severity: "medium", url: "x", message: "" },
        canonicalFix: { diffHint: "add an h1" },
      }),
      { repoRoot: repo, route: "/", files: ["index.html"] },
    );
    expect(patch).toBeNull();
  });
});

describe("nextjsAdapter", () => {
  it("maps App Router and Pages Router routes", async () => {
    await write("app/pricing/page.tsx", "export default function P(){return null}");
    await write("pages/contact.tsx", "export default function C(){return null}");
    expect(await nextjsAdapter.mapRoute("/pricing", repo)).toContain("app/pricing/page.tsx");
    expect(await nextjsAdapter.mapRoute("/contact", repo)).toContain("pages/contact.tsx");
  });

  it("inserts a metadata export after the imports", async () => {
    const page = `import { Hero } from "@/components/hero";

export default function Page() {
  return <Hero />;
}
`;
    await write("app/page.tsx", page);
    const patch = await nextjsAdapter.applyToSource(
      instruction({
        finding: {
          issueType: "missing_canonical",
          severity: "high",
          url: "https://x.com/",
          message: "",
        },
        targetSurfaceChange: { canonical: "https://x.com/" },
        canonicalFix: { html: "<link…/>" },
      }),
      { repoRoot: repo, route: "/", files: ["app/page.tsx"] },
    );

    expect(patch).not.toBeNull();
    const patched = patch?.diffs[0]?.patched ?? "";
    expect(patched).toContain("export const metadata = {");
    expect(patched).toContain('alternates: { canonical: "https://x.com/" }');
    // Imports stay above the inserted export.
    expect(patched.indexOf("import {")).toBeLessThan(patched.indexOf("export const metadata"));
  });

  it("falls back (null) when the page already exports metadata", async () => {
    await write(
      "app/page.tsx",
      `export const metadata = { title: "Home" };\nexport default function P(){return null}`,
    );
    const patch = await nextjsAdapter.applyToSource(
      instruction({
        finding: {
          issueType: "missing_canonical",
          severity: "high",
          url: "https://x.com/",
          message: "",
        },
        targetSurfaceChange: { canonical: "https://x.com/" },
      }),
      { repoRoot: repo, route: "/", files: ["app/page.tsx"] },
    );
    expect(patch).toBeNull(); // universal Patch rail takes over
  });

  it("falls back (null) when generateMetadata is present", async () => {
    await write(
      "app/page.tsx",
      `export async function generateMetadata(){return {}}\nexport default function P(){return null}`,
    );
    const patch = await nextjsAdapter.applyToSource(
      instruction({
        finding: { issueType: "missing_title", severity: "high", url: "x", message: "" },
        targetSurfaceChange: { title: "T" },
      }),
      { repoRoot: repo, route: "/", files: ["app/page.tsx"] },
    );
    expect(patch).toBeNull();
  });
});
