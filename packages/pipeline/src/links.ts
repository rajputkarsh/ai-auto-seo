import type { Finding, SeoSurface } from "@awe/core";

export interface LinkStatus {
  url: string;
  status: number;
}

/**
 * Probes a page's outbound links for their HTTP status. Injected into a scan so
 * the pipeline stays pure and offline by default; the API composes the real,
 * network-backed checker (from `@awe/crawler`) and tests pass a fake. Structural,
 * so any `(links) => Promise<{url,status}[]>` satisfies it.
 */
export type LinkChecker = (links: string[]) => Promise<LinkStatus[]>;

/** Broken = unreachable (0) or a 4xx/5xx response. */
function isBroken(status: number): boolean {
  return status === 0 || status >= 400;
}

/**
 * Turn link-status results into a single `broken_link` finding for the page, or
 * null when every link is healthy. One aggregated finding (not one per link)
 * keeps the report readable and gives the reasoner the full list as evidence.
 */
export function brokenLinkFinding(surface: SeoSurface, statuses: LinkStatus[]): Finding | null {
  const broken = statuses.filter((s) => isBroken(s.status));
  if (broken.length === 0) return null;
  return {
    issueType: "broken_link",
    severity: "medium",
    url: surface.url,
    ...(surface.route ? { route: surface.route } : {}),
    message: `${broken.length} outbound link(s) on this page resolve to an error.`,
    evidence: { brokenLinks: broken },
  };
}
