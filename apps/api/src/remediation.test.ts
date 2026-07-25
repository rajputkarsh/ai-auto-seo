import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RemediationState, registerRemediation } from "./remediation";

/** A page served missing its canonical — the automatable finding the rails fix. */
const HTML =
  "<!doctype html><html><head><title>Home | Acme</title>" +
  '<meta name="description" content="The Acme homepage, welcome."></head>' +
  "<body><h1>Home</h1></body></html>";
const URL = "https://acme.com/";

/** Build the plugin in isolation with a fixed org so requests are deterministic. */
function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerRemediation(app, new RemediationState(), () => "acme");
  return app;
}

describe("connect-and-remediate API", () => {
  let app: FastifyInstance;
  let repoRoot: string;

  beforeAll(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "awe-repo-"));
    writeFileSync(join(repoRoot, "index.html"), HTML);
    app = buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("refuses to remediate before a rail is connected (409, fail-safe)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/remediate/repo",
      payload: { url: URL, html: HTML },
    });
    expect(res.statusCode).toBe(409);
  });

  it("opens a repo PR for the missing canonical once connected", async () => {
    const conn = await app.inject({
      method: "POST",
      url: "/connections/repo",
      payload: { repoRoot, fullName: "acme/site" },
    });
    expect(conn.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/remediate/repo",
      payload: { url: URL, html: HTML },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prsOpened).toBe(1);
    expect(body.fellBack).toBe(0);
    expect(body.items[0].issueType).toBe("missing_canonical");
    expect(body.items[0].outcome.rail).toBe("repo_pr");
  });

  it("stages a CMS draft for the missing canonical once connected", async () => {
    const conn = await app.inject({
      method: "POST",
      url: "/connections/cms",
      payload: { url: URL, entryId: "p1" },
    });
    expect(conn.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/remediate/cms",
      payload: { url: URL, html: HTML },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.drafted).toBe(1);
    expect(body.fellBack).toBe(0);
    expect(body.items[0].outcome.rail).toBe("cms");
  });

  it("reports merge-rate + applied-fix outcomes after both rails ran", async () => {
    const res = await app.inject({ method: "GET", url: "/remediate/outcomes" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.repo.opened).toBe(1);
    expect(body.cms.drafted).toBe(1);
  });

  it("rejects a malformed connection body (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/connections/repo",
      payload: { fullName: "acme/site" },
    });
    expect(res.statusCode).toBe(400);
  });
});
