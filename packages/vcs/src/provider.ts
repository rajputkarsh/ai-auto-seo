import type { SourcePatch } from "@awe/adapters";

export interface RepoRef {
  /** e.g. "owner/repo". */
  fullName: string;
  defaultBranch: string;
}

export interface PullRequest {
  number: number;
  url: string;
  branch: string;
}

export interface OpenPullRequestInput {
  repo: RepoRef;
  branch: string;
  title: string;
  body: string;
  patch: SourcePatch;
}

/**
 * The version-control seam.
 *
 * Opening a PR requires provider auth (a GitHub App installation token, a
 * GitLab project token) that only exists in a deployed environment. Putting it
 * behind this interface means the `repo_pr` rail — branch naming, PR body,
 * validation ordering — is fully built and tested against an in-memory provider
 * now; a `GitHubVcsProvider` implementing the same two methods drops in later
 * without touching the rail.
 */
export interface VcsProvider {
  readonly kind: string;
  openPullRequest(input: OpenPullRequestInput): Promise<PullRequest>;
}

/** Records opened PRs in memory — the default for local runs and tests. */
export class InMemoryVcsProvider implements VcsProvider {
  readonly kind = "memory";
  readonly opened: OpenPullRequestInput[] = [];
  private counter = 0;

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequest> {
    this.opened.push(input);
    const number = ++this.counter;
    return {
      number,
      url: `memory://${input.repo.fullName}/pull/${number}`,
      branch: input.branch,
    };
  }
}
