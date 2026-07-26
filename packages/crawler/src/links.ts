export interface LinkStatus {
  url: string;
  /** HTTP status, or 0 when the link could not be reached at all (DNS/timeout). */
  status: number;
}

/** Probes one URL for its HTTP status. Injectable so the checker is testable. */
export type LinkProber = (url: string) => Promise<number>;

export interface CheckLinksOptions {
  prober?: LinkProber;
  /** Max simultaneous probes — kept low to stay polite to third-party hosts. */
  concurrency?: number;
}

/**
 * The default prober: a `HEAD` first (cheap — no body), falling back to `GET`
 * when a host rejects `HEAD` (many answer 405/501). Redirects are followed, so a
 * 3xx chain ending in 200 is healthy. Any network failure or timeout maps to 0,
 * which the caller treats as broken — an unreachable link is broken from a
 * crawler's point of view.
 */
export function fetchLinkProber(timeoutMs = 8000): LinkProber {
  return async (url) => {
    const probe = async (method: "HEAD" | "GET"): Promise<number> => {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.status;
    };
    try {
      const head = await probe("HEAD");
      // 405/501 (and some 403s) mean "HEAD not allowed", not "resource missing" —
      // confirm with a GET before trusting the status.
      if (head === 405 || head === 501 || head === 403) return await probe("GET");
      return head;
    } catch {
      try {
        return await probe("GET");
      } catch {
        return 0;
      }
    }
  };
}

/** A link is broken if it couldn't be reached (0) or answered 4xx/5xx. */
export function isBroken(status: number): boolean {
  return status === 0 || status >= 400;
}

/**
 * Probe every link's status, bounded by a concurrency cap. Returns one
 * `LinkStatus` per input URL, in input order. Never throws — a probe that fails
 * is reported as status 0, so one bad link can't sink the whole check.
 */
export async function checkLinks(
  links: string[],
  options: CheckLinksOptions = {},
): Promise<LinkStatus[]> {
  const prober = options.prober ?? fetchLinkProber();
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const results: LinkStatus[] = new Array(links.length);

  let next = 0;
  async function worker(): Promise<void> {
    while (next < links.length) {
      const index = next++;
      const url = links[index] as string;
      let status = 0;
      try {
        status = await prober(url);
      } catch {
        status = 0;
      }
      results[index] = { url, status };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, worker));
  return results;
}
