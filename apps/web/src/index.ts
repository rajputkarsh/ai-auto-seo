import { getConfig } from "@awe/config";
import { esc, html, page, raw } from "@awe/ui";
import formbody from "@fastify/formbody";
import Fastify from "fastify";

const config = getConfig();
const app = Fastify({ logger: { level: config.LOG_LEVEL } });
await app.register(formbody); // parse the urlencoded scan form
const API = config.API_BASE_URL;

/**
 * Customer dashboard — the end-user control surface.
 *
 * It renders on the server from the same API a developer would call, so it is a
 * thin, role-aware view over the real data (properties, scan history, findings,
 * plan/usage) rather than a second source of truth. Org identity is carried on
 * the `x-awe-org` header, matching the API's Phase-2 stand-in for auth.
 */
async function api<T>(path: string, org: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-awe-org": org, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

function orgOf(req: { query: unknown }): string {
  const q = req.query as { org?: string };
  return q.org?.trim() || "default";
}

app.get("/healthz", async () => ({ ok: true }));

app.get("/", async (req, reply) => {
  const org = orgOf(req);
  let billing: {
    tier: string;
    usage: { scans: number };
    entitlements: { maxScansPerMonth: number | null };
  };
  try {
    billing = await api("/billing/status", org);
  } catch {
    reply.code(502);
    return page({
      title: "AI Website Engineer",
      body: `<p>API unreachable at <code>${esc(API)}</code>. Start it with <code>pnpm dev:api</code>.</p>`,
    });
  }

  const quota = billing.entitlements.maxScansPerMonth;
  const body = html`
    <header><h1>AI Website Engineer</h1><span class="badge">${billing.tier} plan</span></header>
    <p class="muted">Org <code>${org}</code> · ${billing.usage.scans}${raw(quota === null ? "" : ` / ${esc(quota)}`)} scans this month</p>

    <h2>Scan a property</h2>
    <form method="post" action="/scan">
      <input type="hidden" name="org" value="${org}">
      <input name="url" placeholder="https://example.com" size="40" required>
      <button type="submit">Scan site</button>
    </form>
    <p class="muted">Crawls the property, evaluates every page together, and compares against its history.</p>

    <p><a href="/integrations?org=${org}">Integrations &amp; remediation rails →</a></p>
  `;
  reply.type("text/html");
  return page({ title: "AI Website Engineer", body });
});

type Connections = { repo: { fullName: string } | null; cms: { platform: string } | null };
type Outcomes = {
  repo: { opened: number; merged: number };
  cms: { drafted: number; applied: number };
};

/**
 * Integrations surface — makes the higher remediation rails (repo PR, CMS write)
 * reachable through the product, not only via the API. Connecting is per-org and
 * the outcome panel shows the North-Star quality metrics (merge-rate, applied-fix).
 */
app.get("/integrations", async (req, reply) => {
  const org = orgOf(req);
  let conns: Connections;
  let outcomes: Outcomes;
  try {
    [conns, outcomes] = await Promise.all([
      api<Connections>("/connections", org),
      api<Outcomes>("/remediate/outcomes", org),
    ]);
  } catch {
    reply.code(502).type("text/html");
    return page({
      title: "Integrations",
      body: `<p>API unreachable at <code>${esc(API)}</code>. Start it with <code>pnpm dev:api</code>.</p>`,
    });
  }

  const notice = (req.query as { msg?: string }).msg;
  const repoStatus = conns.repo
    ? html`<span class="badge">connected</span> <code>${conns.repo.fullName}</code>`
    : raw('<span class="muted">not connected</span>');
  const cmsStatus = conns.cms
    ? html`<span class="badge">connected</span> <code>${conns.cms.platform}</code>`
    : raw('<span class="muted">not connected</span>');

  const body = html`
    <header><h1>Integrations</h1><a href="/?org=${org}">← dashboard</a></header>
    <p class="muted">Org <code>${org}</code></p>
    ${notice ? raw(`<p class="badge">${esc(notice)}</p>`) : raw("")}

    <h2>Repository rail (PR)</h2>
    <p>${repoStatus}</p>
    <form method="post" action="/connect/repo">
      <input type="hidden" name="org" value="${org}">
      <input name="repoRoot" placeholder="/path/to/checkout" size="34" required>
      <input name="fullName" placeholder="owner/repo" size="20" required>
      <button type="submit">Connect repo</button>
    </form>

    <h2>CMS rail (draft)</h2>
    <p>${cmsStatus}</p>
    <form method="post" action="/connect/cms">
      <input type="hidden" name="org" value="${org}">
      <input name="url" placeholder="https://example.com/page" size="34" required>
      <input name="entryId" placeholder="entry id" size="16">
      <button type="submit">Connect CMS entry</button>
    </form>

    <h2>Remediate a URL</h2>
    <form method="post" action="/remediate">
      <input type="hidden" name="org" value="${org}">
      <input name="url" placeholder="https://example.com/page" size="34" required>
      <select name="rail">
        <option value="repo">via repo PR</option>
        <option value="cms">via CMS draft</option>
      </select>
      <button type="submit">Fetch &amp; remediate</button>
    </form>
    <p class="muted">Fetches the page, detects automatable findings, and applies them through the selected rail.</p>

    <h2>Outcomes</h2>
    <div class="card">
      <strong>Repo</strong> — ${outcomes.repo.opened} PR(s) opened · ${outcomes.repo.merged} merged<br>
      <strong>CMS</strong> — ${outcomes.cms.drafted} draft(s) staged · ${outcomes.cms.applied} applied
    </div>
  `;
  reply.type("text/html");
  return page({ title: "Integrations", body });
});

function backToIntegrations(reply: { redirect: (u: string) => unknown }, org: string, msg: string) {
  return reply.redirect(
    `/integrations?org=${encodeURIComponent(org)}&msg=${encodeURIComponent(msg)}`,
  );
}

app.post("/connect/repo", async (req, reply) => {
  const b = req.body as { org?: string; repoRoot?: string; fullName?: string };
  const org = b.org?.trim() || "default";
  try {
    await api("/connections/repo", org, {
      method: "POST",
      body: JSON.stringify({ repoRoot: b.repoRoot?.trim(), fullName: b.fullName?.trim() }),
    });
    return backToIntegrations(reply, org, `Repo connected: ${b.fullName}`);
  } catch (err) {
    return backToIntegrations(reply, org, `Connect failed: ${String(err)}`);
  }
});

app.post("/connect/cms", async (req, reply) => {
  const b = req.body as { org?: string; url?: string; entryId?: string };
  const org = b.org?.trim() || "default";
  try {
    await api("/connections/cms", org, {
      method: "POST",
      body: JSON.stringify({
        url: b.url?.trim(),
        ...(b.entryId?.trim() ? { entryId: b.entryId.trim() } : {}),
      }),
    });
    return backToIntegrations(reply, org, `CMS entry connected: ${b.url}`);
  } catch (err) {
    return backToIntegrations(reply, org, `Connect failed: ${String(err)}`);
  }
});

app.post("/remediate", async (req, reply) => {
  const b = req.body as { org?: string; url?: string; rail?: string };
  const org = b.org?.trim() || "default";
  const url = b.url?.trim();
  const rail = b.rail === "cms" ? "cms" : "repo";
  if (!url) return backToIntegrations(reply, org, "A URL is required");
  try {
    const resp = await fetch(url);
    const pageHtml = await resp.text();
    const summary = await api<{ prsOpened?: number; drafted?: number; fellBack: number }>(
      `/remediate/${rail}`,
      org,
      { method: "POST", body: JSON.stringify({ url, html: pageHtml }) },
    );
    const applied = rail === "repo" ? summary.prsOpened : summary.drafted;
    return backToIntegrations(
      reply,
      org,
      `Remediated via ${rail}: ${applied ?? 0} applied, ${summary.fellBack} fell back`,
    );
  } catch (err) {
    return backToIntegrations(reply, org, `Remediation failed: ${String(err)}`);
  }
});

app.post("/scan", async (req, reply) => {
  const parsed = req.body as { url?: string; org?: string };
  const org = parsed.org?.trim() || "default";
  const url = parsed.url?.trim();
  if (!url) return reply.redirect("/");

  type SiteResult = {
    baseUrl: string;
    issueCount: number;
    regressionCount: number;
    pages: {
      url: string;
      items: {
        finding: { issueType: string; severity: string; isRegression?: boolean };
        recommendation: string;
        patch?: string;
      }[];
    }[];
  };

  let result: SiteResult;
  try {
    result = await api("/site-scan", org, {
      method: "POST",
      body: JSON.stringify({ url, minDelayMs: 0 }),
    });
  } catch (err) {
    reply.code(502).type("text/html");
    return page({
      title: "Scan failed",
      body: `<p>Scan failed: ${esc(String(err))}</p><a href="/?org=${esc(org)}">Back</a>`,
    });
  }

  const pages = result.pages
    .map((p) => {
      const items = p.items
        .map(
          (i) => html`<div class="card">
            <strong>${i.finding.isRegression ? raw('<span class="reg">⚠ REGRESSION</span> ') : raw("")}${i.finding.issueType}</strong>
            <span class="muted">(${i.finding.severity})</span>
            <pre class="muted" style="white-space:pre-wrap">${i.recommendation}</pre>
            ${i.patch ? raw(`<details><summary>patch</summary><pre>${esc(i.patch)}</pre></details>`) : raw('<span class="muted">no auto-patch</span>')}
          </div>`,
        )
        .join("");
      return html`<h2>${p.url}</h2>${items ? raw(items) : raw('<p class="muted">clean ✓</p>')}`;
    })
    .join("");

  reply.type("text/html");
  return page({
    title: `Scan · ${result.baseUrl}`,
    body: html`
      <header><h1>${result.baseUrl}</h1><a href="/?org=${org}">← new scan</a></header>
      <p><strong>${result.issueCount}</strong> issue(s) · <strong class="${result.regressionCount ? "reg" : ""}">${result.regressionCount}</strong> regression(s)</p>
      ${raw(pages)}
    `,
  });
});

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => app.log.info(`dashboard on ${addr} (API: ${API})`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
