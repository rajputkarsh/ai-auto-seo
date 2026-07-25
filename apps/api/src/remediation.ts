import { detectFramework } from "@awe/adapters";
import type { RemediationInstruction } from "@awe/core";
import { runScan } from "@awe/pipeline";
import {
  applyCmsRail,
  type CmsOutcomeStore,
  InMemoryCmsOutcomeStore,
  InMemoryPlatform,
} from "@awe/platforms";
import {
  applyRepoRail,
  InMemoryPrOutcomeStore,
  InMemoryVcsProvider,
  type PrOutcomeStore,
} from "@awe/vcs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

/**
 * The connect-and-remediate surface: makes the Phase-3 (repo PR) and Phase-4
 * (CMS write) rails reachable through the product instead of only as library
 * functions. Providers are in-memory so this runs end-to-end with no external
 * credentials; a deployment swaps in `GitHubVcsProvider` / `WordPressPlatform`
 * behind the same interfaces without touching this wiring.
 */
interface RepoConnection {
  repoRoot: string;
  fullName: string;
  defaultBranch: string;
}

/** Per-org connections + shared outcome stores (merge-rate, applied-fix rate). */
export class RemediationState {
  readonly repos = new Map<string, RepoConnection>();
  readonly platforms = new Map<string, InMemoryPlatform>();
  readonly vcs = new InMemoryVcsProvider();
  readonly prOutcomes: PrOutcomeStore;
  readonly cmsOutcomes: CmsOutcomeStore;

  /**
   * The outcome stores are injectable so a deployment can pass Postgres-backed
   * ones (merge-rate/applied-fix history must survive a restart); they default
   * to in-memory so the plugin runs with no database. The VCS provider and CMS
   * platforms stay in-memory here because a real deployment swaps them for
   * GitHub/WordPress at the connection layer, not via this state object.
   */
  constructor(stores?: { prOutcomes?: PrOutcomeStore; cmsOutcomes?: CmsOutcomeStore }) {
    this.prOutcomes = stores?.prOutcomes ?? new InMemoryPrOutcomeStore();
    this.cmsOutcomes = stores?.cmsOutcomes ?? new InMemoryCmsOutcomeStore();
  }
}

const repoConnBody = z.object({
  repoRoot: z.string().min(1),
  fullName: z.string().min(1),
  defaultBranch: z.string().default("main"),
});
const cmsConnBody = z.object({
  url: z.string().url(),
  entryId: z.string().default("entry-1"),
  type: z.string().default("page"),
});
const remediateBody = z.object({ url: z.string().url(), html: z.string().min(1) });

/** Scan the given HTML and return the per-finding instructions + issue baseline. */
async function instructionsFor(
  html: string,
  url: string,
): Promise<{
  instructions: RemediationInstruction[];
  baseline: Set<RemediationInstruction["finding"]["issueType"]>;
}> {
  const result = await runScan(html, url);
  const instructions = result.items.map((i) => i.instruction);
  const baseline = new Set(instructions.map((i) => i.finding.issueType));
  return { instructions, baseline };
}

export function registerRemediation(
  app: FastifyInstance,
  state: RemediationState,
  orgOf: (req: FastifyRequest) => string,
): void {
  const bad = (msg: string, issues?: unknown) => ({
    error: { code: "invalid_request", message: msg, ...(issues ? { details: issues } : {}) },
  });

  app.get("/connections", async (req) => {
    const org = orgOf(req);
    return {
      repo: state.repos.get(org) ?? null,
      cms: state.platforms.has(org) ? { platform: "memory" } : null,
    };
  });

  app.post("/connections/repo", async (req, reply) => {
    const parsed = repoConnBody.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send(bad("bad repo connection", parsed.error.issues));
    state.repos.set(orgOf(req), parsed.data);
    return { ok: true, connected: parsed.data.fullName };
  });

  app.post("/connections/cms", async (req, reply) => {
    const parsed = cmsConnBody.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send(bad("bad cms connection", parsed.error.issues));
    const org = orgOf(req);
    const platform = state.platforms.get(org) ?? new InMemoryPlatform();
    platform.seed(parsed.data.url, { entryId: parsed.data.entryId, type: parsed.data.type });
    state.platforms.set(org, platform);
    return { ok: true, seeded: parsed.data.url };
  });

  /** POST /remediate/repo { url, html } — open PRs for automatable findings. */
  app.post("/remediate/repo", async (req, reply) => {
    const parsed = remediateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad("bad request", parsed.error.issues));
    const org = orgOf(req);
    const conn = state.repos.get(org);
    if (!conn) return reply.code(409).send(bad("no repo connected for this org"));

    const adapter = await detectFramework(conn.repoRoot);
    if (!adapter)
      return reply.code(422).send(bad("could not detect a framework in the connected repo"));

    const { instructions, baseline } = await instructionsFor(parsed.data.html, parsed.data.url);
    const summary = await applyRepoRail(
      instructions,
      {
        orgId: org,
        repo: { fullName: conn.fullName, defaultBranch: conn.defaultBranch },
        repoRoot: conn.repoRoot,
        baseline,
      },
      { adapter, vcs: state.vcs, outcomes: state.prOutcomes },
    );
    req.log.info(
      {
        org,
        framework: adapter.framework,
        prsOpened: summary.prsOpened,
        fellBack: summary.fellBack,
      },
      "repo rail",
    );
    return summary;
  });

  /** POST /remediate/cms { url, html } — stage CMS drafts for automatable findings. */
  app.post("/remediate/cms", async (req, reply) => {
    const parsed = remediateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad("bad request", parsed.error.issues));
    const org = orgOf(req);
    const platform = state.platforms.get(org);
    if (!platform) return reply.code(409).send(bad("no CMS connected for this org"));

    const { instructions } = await instructionsFor(parsed.data.html, parsed.data.url);
    const summary = await applyCmsRail(
      instructions,
      { orgId: org, connectionId: `cms:${org}`, url: parsed.data.url },
      { adapter: platform, outcomes: state.cmsOutcomes },
    );
    req.log.info({ org, drafted: summary.drafted, fellBack: summary.fellBack }, "cms rail");
    return summary;
  });

  /** GET /remediate/outcomes — merge-rate (repo) + applied-fix rate (CMS). */
  app.get("/remediate/outcomes", async (req) => {
    const org = orgOf(req);
    return {
      repo: await state.prOutcomes.mergeRate(org),
      cms: await state.cmsOutcomes.appliedFixRate(org),
    };
  });
}
