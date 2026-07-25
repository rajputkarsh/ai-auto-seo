import type { RemediationInstruction } from "@awe/core";
import type { PrOutcomeStore } from "./outcomes";
import type { RepoRef } from "./provider";
import { type FallbackReason, openRepoPr, type RepoPrDeps } from "./repo-pr";

export interface RepoRailContext {
  orgId: string;
  repo: RepoRef;
  repoRoot: string;
  /** Issue types already present across the property, so the gate flags only NEW ones. */
  baseline?: Set<RemediationInstruction["finding"]["issueType"]>;
}

export interface RepoRailItem {
  issueType: string;
  route: string;
  outcome:
    | { rail: "repo_pr"; url: string; number: number; branch: string }
    | { rail: "fallback"; reason: FallbackReason };
}

export interface RepoRailSummary {
  items: RepoRailItem[];
  prsOpened: number;
  fellBack: number;
}

/**
 * Run the repo rail across every automatable finding in a scan.
 *
 * Each finding is independent: one adapter decline or gate failure produces a
 * fallback for *that* finding only and never blocks the others. Opened PRs are
 * recorded in the outcome store so merge-rate can be tracked. The caller serves
 * the universal Patch rail for anything that fell back — so connecting a repo
 * strictly adds PRs, never removes coverage.
 */
export async function applyRepoRail(
  instructions: RemediationInstruction[],
  ctx: RepoRailContext,
  deps: RepoPrDeps & { outcomes?: PrOutcomeStore },
): Promise<RepoRailSummary> {
  const items: RepoRailItem[] = [];

  for (const instruction of instructions) {
    const route = instruction.finding.route ?? new URL(instruction.finding.url).pathname;
    const result = await openRepoPr(
      {
        instruction,
        repo: ctx.repo,
        repoRoot: ctx.repoRoot,
        route,
        ...(ctx.baseline ? { baseline: ctx.baseline } : {}),
      },
      deps,
    );

    if (result.status === "opened") {
      await deps.outcomes?.recordOpened({
        orgId: ctx.orgId,
        repo: ctx.repo.fullName,
        prNumber: result.number,
        url: result.url,
        issueType: instruction.finding.issueType,
      });
      items.push({
        issueType: instruction.finding.issueType,
        route,
        outcome: { rail: "repo_pr", url: result.url, number: result.number, branch: result.branch },
      });
    } else {
      items.push({
        issueType: instruction.finding.issueType,
        route,
        outcome: { rail: "fallback", reason: result.reason },
      });
    }
  }

  const prsOpened = items.filter((i) => i.outcome.rail === "repo_pr").length;
  return { items, prsOpened, fellBack: items.length - prsOpened };
}
