import { describe, expect, it } from "vitest";
import { brokenLinkFinding, type LinkChecker } from "./links";
import { runScan } from "./pipeline";
import { runSiteScan } from "./site";

/** A healthy page except for two outbound links, one of which is dead. */
const HTML =
  `<!doctype html><html><head><title>Home | Acme</title>` +
  `<meta name="description" content="The Acme homepage, welcome all visitors."/>` +
  `<link rel="canonical" href="https://acme.com/"/></head>` +
  `<body><h1>Home</h1><a href="/ok">ok</a><a href="/gone">gone</a></body></html>`;

const checker: LinkChecker = async (links) =>
  links.map((url) => ({ url, status: url.endsWith("/gone") ? 404 : 200 }));

describe("brokenLinkFinding", () => {
  it("aggregates the broken links into one finding with evidence", () => {
    const finding = brokenLinkFinding({ url: "https://acme.com/" }, [
      { url: "https://acme.com/ok", status: 200 },
      { url: "https://acme.com/gone", status: 404 },
      { url: "https://acme.com/down", status: 0 },
    ]);
    expect(finding?.issueType).toBe("broken_link");
    expect(finding?.message).toContain("2 outbound link(s)");
    expect(finding?.evidence?.brokenLinks).toHaveLength(2);
  });

  it("returns null when every link is healthy", () => {
    expect(
      brokenLinkFinding({ url: "https://x/" }, [{ url: "https://x/a", status: 200 }]),
    ).toBeNull();
  });
});

describe("runScan with a link checker", () => {
  it("adds a broken_link finding only when a checker is supplied", async () => {
    const without = await runScan(HTML, "https://acme.com/");
    expect(without.items.some((i) => i.finding.issueType === "broken_link")).toBe(false);

    const withCheck = await runScan(HTML, "https://acme.com/", { linkChecker: checker });
    const broken = withCheck.items.find((i) => i.finding.issueType === "broken_link");
    expect(broken).toBeDefined();
    // It's recommendation-only — no auto-patch for a dead link.
    expect(broken?.patch).toBeUndefined();
    expect(broken?.recommendation).toContain("broken");
  });
});

describe("runSiteScan with a link checker", () => {
  it("probes each page's links", async () => {
    const result = await runSiteScan(
      "https://acme.com",
      [{ url: "https://acme.com/", html: HTML }],
      { linkChecker: checker },
    );
    const page = result.pages[0];
    expect(page?.items.some((i) => i.finding.issueType === "broken_link")).toBe(true);
  });
});
