import { getConfig } from "@awe/config";
import { esc, html, page, raw } from "@awe/ui";
import formbody from "@fastify/formbody";
import Fastify from "fastify";

/**
 * Superadmin console — the staff-only, cross-tenant back office.
 *
 * Deliberately a SEPARATE app from the customer dashboard (per the Superadmin
 * doc's isolation requirement): different process, different port, and it holds
 * the staff token that unlocks the API's `/admin/*` namespace. It renders over
 * that admin API, so cross-tenant access lives in exactly one place (the API),
 * not duplicated here.
 *
 * Fail-closed: with no STAFF_TOKEN configured the app refuses to start.
 */
const config = getConfig();
if (!config.STAFF_TOKEN) {
  console.error("STAFF_TOKEN is required to run the admin console. Refusing to start.");
  process.exit(1);
}
const STAFF_TOKEN: string = config.STAFF_TOKEN;
const API = config.API_BASE_URL;

const app = Fastify({ logger: { level: config.LOG_LEVEL } });
await app.register(formbody);

async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/admin${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${STAFF_TOKEN}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`admin API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

const ACCENT = "#7c3aed"; // distinct from the customer dashboard, on purpose

app.get("/healthz", async () => ({ ok: true }));

interface OrgRow {
  orgId: string;
  tier: string;
  suspended: boolean;
  entitlements: { maxScansPerMonth: number | null };
  usage: { scans: number; pagesCrawled: number; llmCostCents: number };
}

app.get("/", async (_req, reply) => {
  let orgs: OrgRow[];
  try {
    ({ orgs } = await adminApi<{ orgs: OrgRow[] }>("/orgs"));
  } catch (err) {
    reply.code(502).type("text/html");
    return page({
      title: "Admin",
      accent: ACCENT,
      body: `<p>Admin API unreachable: ${esc(String(err))}</p>`,
    });
  }

  const rows = orgs
    .map(
      (o) => html`<tr>
        <td><code>${o.orgId}</code></td>
        <td>${o.tier}${o.suspended ? raw(' <span class="reg">suspended</span>') : raw("")}</td>
        <td>${o.usage.scans}${raw(o.entitlements.maxScansPerMonth === null ? "" : ` / ${esc(o.entitlements.maxScansPerMonth)}`)}</td>
        <td>${o.usage.pagesCrawled}</td>
        <td>${(o.usage.llmCostCents / 100).toFixed(2)}</td>
        <td>${raw(actionForm(o))}</td>
      </tr>`,
    )
    .join("");

  reply.type("text/html");
  return page({
    title: "Superadmin",
    accent: ACCENT,
    body: html`
      <header><h1>Superadmin</h1><span class="badge">cross-tenant</span></header>
      <p class="muted">${orgs.length} organization(s). <a href="/audit">audit log →</a></p>
      <table>
        <tr><th>org</th><th>plan</th><th>scans</th><th>pages</th><th>LLM $</th><th>actions</th></tr>
        ${raw(rows)}
      </table>
      ${raw(orgs.length === 0 ? '<p class="muted">No orgs yet — run a scan against the API to create one.</p>' : "")}
    `,
  });
});

function actionForm(o: OrgRow): string {
  const tiers = ["free", "pro", "team", "enterprise"]
    .map((t) => `<option ${t === o.tier ? "selected" : ""}>${t}</option>`)
    .join("");
  return `
    <form method="post" action="/plan" style="display:inline">
      <input type="hidden" name="orgId" value="${esc(o.orgId)}">
      <select name="tier">${tiers}</select>
      <button>set plan</button>
    </form>
    <form method="post" action="/suspend" style="display:inline">
      <input type="hidden" name="orgId" value="${esc(o.orgId)}">
      <input type="hidden" name="suspended" value="${o.suspended ? "false" : "true"}">
      <button>${o.suspended ? "unsuspend" : "suspend"}</button>
    </form>`;
}

app.post("/plan", async (req, reply) => {
  const { orgId, tier } = req.body as { orgId: string; tier: string };
  await adminApi(`/orgs/${encodeURIComponent(orgId)}/plan`, {
    method: "POST",
    body: JSON.stringify({ tier }),
  });
  return reply.redirect("/");
});

app.post("/suspend", async (req, reply) => {
  const { orgId, suspended } = req.body as { orgId: string; suspended: string };
  await adminApi(`/orgs/${encodeURIComponent(orgId)}/suspend`, {
    method: "POST",
    body: JSON.stringify({ suspended: suspended === "true" }),
  });
  return reply.redirect("/");
});

app.get("/audit", async (_req, reply) => {
  const { entries } = await adminApi<{ entries: { at: string; action: string; orgId: string }[] }>(
    "/audit",
  );
  const rows = entries
    .map((e) => html`<tr><td>${e.at}</td><td>${e.action}</td><td><code>${e.orgId}</code></td></tr>`)
    .join("");
  reply.type("text/html");
  return page({
    title: "Audit log",
    accent: ACCENT,
    body: html`<header><h1>Audit log</h1><a href="/">← orgs</a></header>
      <table><tr><th>when</th><th>action</th><th>org</th></tr>${raw(rows)}</table>`,
  });
});

const port = Number(process.env.PORT ?? 4100);
app
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => app.log.info(`admin console on ${addr} (API: ${API})`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
