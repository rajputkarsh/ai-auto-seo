/** Allow/Disallow patterns from robots.txt, for the wildcard user-agent group. */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/**
 * Parse the `User-agent: *` group's rules.
 *
 * Only the wildcard group is honoured: a rule aimed at one named bot is a
 * deliberate choice about *that* crawler and says nothing about ours.
 */
export function parseRobots(robotsTxt: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] };
  let inWildcardGroup = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;

    const [rawField, ...rest] = line.split(":");
    const field = rawField?.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (field === "user-agent") {
      inWildcardGroup = value === "*";
      continue;
    }
    if (!inWildcardGroup) continue;

    // `Disallow:` with an empty value means "nothing is disallowed" — it must
    // not be recorded as a pattern, or it would match every path.
    if (field === "disallow" && value) rules.disallow.push(value);
    if (field === "allow" && value) rules.allow.push(value);
  }
  return rules;
}

/**
 * Standard robots precedence: the longest matching pattern wins, and Allow
 * beats Disallow on a tie. Supports `*` wildcards and the `$` end-anchor.
 */
export function isAllowed(path: string, rules: RobotsRules): boolean {
  const longestAllow = longestMatch(path, rules.allow);
  const longestDisallow = longestMatch(path, rules.disallow);

  if (longestDisallow === -1) return true;
  return longestAllow >= longestDisallow;
}

/** True when the wildcard group disallows the site root. */
export function blocksAllCrawling(robotsTxt: string): boolean {
  return !isAllowed("/", parseRobots(robotsTxt));
}

/** First `Sitemap:` declaration, if any. Sitemap lines are group-independent. */
export function sitemapUrlFromRobots(robotsTxt: string): string | undefined {
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    const match = line.match(/^sitemap:\s*(\S+)/i);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function longestMatch(path: string, patterns: string[]): number {
  let longest = -1;
  for (const pattern of patterns) {
    if (patternToRegex(pattern).test(path)) longest = Math.max(longest, pattern.length);
  }
  return longest;
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}
