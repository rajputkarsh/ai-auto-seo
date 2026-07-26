import { getConfig } from "@awe/config";
import { esc, html, page, raw } from "@awe/ui";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyRequest } from "fastify";

const config = getConfig();
const app = Fastify({ logger: { level: config.LOG_LEVEL } });
await app.register(cookie); // read/write the session cookie holding the API key
await app.register(formbody); // parse the urlencoded forms
const API = config.API_BASE_URL;

/** Name of the httpOnly cookie holding the caller's API key. */
const KEY_COOKIE = "awe_key";

/** Thrown when the API answers 401 — the caller must (re)authenticate. */
class Unauthorized extends Error {}

/**
 * Customer dashboard — the end-user control surface.
 *
 * It renders on the server from the same API a developer would call, so it is a
 * thin, role-aware view over the real data. Authentication is a real credential:
 * the user signs in with an API key, which we keep in an httpOnly cookie and
 * forward as `Authorization: Bearer` to the API. When no cookie is present we
 * fall back to the `x-awe-org` header (which only the API's dev mode honours), so
 * local development still works with no sign-in.
 */
type Creds = Record<string, string>;

function credsOf(req: FastifyRequest, orgFallback?: string): Creds {
  const key = req.cookies?.[KEY_COOKIE];
  if (key) return { authorization: `Bearer ${key}` };
  const org = (orgFallback ?? (req.query as { org?: string })?.org)?.trim();
  return org ? { "x-awe-org": org } : {};
}

async function api<T>(path: string, creds: Creds, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...creds, ...(init?.headers ?? {}) },
  });
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

interface WhoAmI {
  orgId: string;
  role: string;
  via: string;
}

/** Resolve the caller's identity from the API (the source of truth for who they are). */
async function whoami(creds: Creds): Promise<WhoAmI> {
  return api<WhoAmI>("/auth/whoami", creds);
}

app.get("/healthz", async () => ({ ok: true }));

/** Sign-in page: paste an API key. Optional `?next=` returns you where you came from. */
app.get("/login", async (req, reply) => {
  const err = (req.query as { err?: string }).err;
  reply.type("text/html");
  return page({
    title: "Sign in",
    body: html`
      <header><h1>Sign in</h1></header>
      ${err ? raw(`<p class="reg">${esc(err)}</p>`) : raw("")}
      <p class="muted">Paste an API key (a superadmin issues one per org). It's stored in an httpOnly cookie and sent as a Bearer token to the API.</p>
      <form method="post" action="/login">
        <input name="key" type="password" placeholder="awe_…" size="40" required autofocus>
        <button type="submit">Sign in</button>
      </form>
      <p class="muted">Running the API in dev mode? You can skip sign-in and pass <code>?org=yourorg</code> in the URL instead.</p>
    `,
  });
});

app.post("/login", async (req, reply) => {
  const key = (req.body as { key?: string }).key?.trim();
  if (!key) return reply.redirect("/login?err=A+key+is+required");
  try {
    // Validate the key by resolving identity; a 401 means it's wrong/revoked.
    await whoami({ authorization: `Bearer ${key}` });
  } catch {
    return reply.redirect("/login?err=That+key+was+not+accepted");
  }
  reply.setCookie(KEY_COOKIE, key, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.NODE_ENV === "production",
  });
  return reply.redirect("/");
});

app.get("/logout", async (_req, reply) => {
  reply.clearCookie(KEY_COOKIE, { path: "/" });
  return reply.redirect("/login");
});

app.get("/", async (req, reply) => {
  const creds = credsOf(req);
  let billing: {
    orgId: string;
    tier: string;
    usage: { scans: number };
    entitlements: { maxScansPerMonth: number | null };
  };
  try {
    billing = await api("/billing/status", creds);
  } catch (err) {
    if (err instanceof Unauthorized) return reply.redirect("/login");
    reply.code(502);
    return page({
      title: "AI Website Engineer",
      body: `<p>API unreachable at <code>${esc(API)}</code>. Start it with <code>pnpm dev:api</code>.</p>`,
    });
  }

  const org = billing.orgId;
  const signedIn = Boolean(req.cookies?.[KEY_COOKIE]);
  const quota = billing.entitlements.maxScansPerMonth;
  const body = html`
    <header><h1>AI Website Engineer</h1><span class="badge">${billing.tier} plan</span></header>
    <p class="muted">Org <code>${org}</code> · ${billing.usage.scans}${raw(quota === null ? "" : ` / ${esc(quota)}`)} scans this month · ${signedIn ? raw('<a href="/logout">sign out</a>') : raw('<a href="/login">sign in</a>')}</p>

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
  const creds = credsOf(req);
  let org: string;
  let conns: Connections;
  let outcomes: Outcomes;
  try {
    const [me, c, o] = await Promise.all([
      whoami(creds),
      api<Connections>("/connections", creds),
      api<Outcomes>("/remediate/outcomes", creds),
    ]);
    org = me.orgId;
    conns = c;
    outcomes = o;
  } catch (err) {
    if (err instanceof Unauthorized) return reply.redirect("/login");
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
  const creds = credsOf(req, org);
  try {
    await api("/connections/repo", creds, {
      method: "POST",
      body: JSON.stringify({ repoRoot: b.repoRoot?.trim(), fullName: b.fullName?.trim() }),
    });
    return backToIntegrations(reply, org, `Repo connected: ${b.fullName}`);
  } catch (err) {
    if (err instanceof Unauthorized) return reply.redirect("/login");
    return backToIntegrations(reply, org, `Connect failed: ${String(err)}`);
  }
});

app.post("/connect/cms", async (req, reply) => {
  const b = req.body as { org?: string; url?: string; entryId?: string };
  const org = b.org?.trim() || "default";
  const creds = credsOf(req, org);
  try {
    await api("/connections/cms", creds, {
      method: "POST",
      body: JSON.stringify({
        url: b.url?.trim(),
        ...(b.entryId?.trim() ? { entryId: b.entryId.trim() } : {}),
      }),
    });
    return backToIntegrations(reply, org, `CMS entry connected: ${b.url}`);
  } catch (err) {
    if (err instanceof Unauthorized) return reply.redirect("/login");
    return backToIntegrations(reply, org, `Connect failed: ${String(err)}`);
  }
});

app.post("/remediate", async (req, reply) => {
  const b = req.body as { org?: string; url?: string; rail?: string };
  const org = b.org?.trim() || "default";
  const creds = credsOf(req, org);
  const url = b.url?.trim();
  const rail = b.rail === "cms" ? "cms" : "repo";
  if (!url) return backToIntegrations(reply, org, "A URL is required");
  try {
    const resp = await fetch(url);
    const pageHtml = await resp.text();
    const summary = await api<{ prsOpened?: number; drafted?: number; fellBack: number }>(
      `/remediate/${rail}`,
      creds,
      { method: "POST", body: JSON.stringify({ url, html: pageHtml }) },
    );
    const applied = rail === "repo" ? summary.prsOpened : summary.drafted;
    return backToIntegrations(
      reply,
      org,
      `Remediated via ${rail}: ${applied ?? 0} applied, ${summary.fellBack} fell back`,
    );
  } catch (err) {
    if (err instanceof Unauthorized) return reply.redirect("/login");
    return backToIntegrations(reply, org, `Remediation failed: ${String(err)}`);
  }
});

app.post("/scan", async (req, reply) => {
  const parsed = req.body as { url?: string; org?: string };
  const org = parsed.org?.trim() || "default";
  const creds = credsOf(req, org);
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
    result = await api("/site-scan", creds, {
      method: "POST",
      body: JSON.stringify({ url, minDelayMs: 0 }),
    });
  } catch (err) {
    if (err instanceof Unauthorized) return reply.redirect("/login");
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
