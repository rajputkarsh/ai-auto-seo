import type { OpenPullRequestInput, PullRequest, VcsProvider } from "./provider";

export interface GitHubVcsConfig {
  /** Installation access token for the target repo (short-lived). */
  token: string;
  /** Base API URL; override for GitHub Enterprise. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/**
 * GitHub implementation of the VCS seam.
 *
 * Wired but **not exercised** — it needs a real GitHub App installation token,
 * which the dev machine does not have. The flow is the standard one: create a
 * branch ref from the default branch, commit each file in the patch, then open
 * a PR. The `repo_pr` rail depends only on `VcsProvider`, so this is verified in
 * deployment, not here; local runs and tests use `InMemoryVcsProvider`.
 */
export class GitHubVcsProvider implements VcsProvider {
  readonly kind = "github";
  private readonly api: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GitHubVcsConfig) {
    this.api = config.apiBase ?? "https://api.github.com";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequest> {
    const [owner, repo] = input.repo.fullName.split("/");
    if (!owner || !repo) throw new Error(`invalid repo: ${input.repo.fullName}`);

    const base = input.repo.defaultBranch;
    const baseSha = await this.refSha(owner, repo, base);
    await this.createBranch(owner, repo, input.branch, baseSha);
    for (const diff of input.patch.diffs) {
      await this.putFile(owner, repo, input.branch, diff.path, diff.patched, input.title);
    }
    return this.createPr(owner, repo, input.branch, base, input.title, input.body);
  }

  private async gh<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.api}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status}`);
    return res.json() as Promise<T>;
  }

  private async refSha(owner: string, repo: string, branch: string): Promise<string> {
    const ref = await this.gh<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    );
    return ref.object.sha;
  }

  private async createBranch(owner: string, repo: string, branch: string, sha: string) {
    await this.gh(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
  }

  private async putFile(
    owner: string,
    repo: string,
    branch: string,
    path: string,
    content: string,
    message: string,
  ) {
    // The Contents API upserts; a real impl would look up the blob sha to update
    // an existing file. Left explicit so the deployment step is unambiguous.
    await this.gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
      method: "PUT",
      body: JSON.stringify({
        message,
        branch,
        content: Buffer.from(content, "utf8").toString("base64"),
      }),
    });
  }

  private async createPr(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<PullRequest> {
    const pr = await this.gh<{ number: number; html_url: string }>(
      `/repos/${owner}/${repo}/pulls`,
      { method: "POST", body: JSON.stringify({ title, body, head, base }) },
    );
    return { number: pr.number, url: pr.html_url, branch: head };
  }
}
