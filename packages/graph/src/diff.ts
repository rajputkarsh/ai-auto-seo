import type { Finding, SeoSurface, Severity } from "@awe/core";

/**
 * Compare a page's previous and current SEO surface and report what got WORSE.
 *
 * This is the universal "catch it the moment it's live" mechanism: it needs no
 * preview deploy or repo access, only two scans of the same URL.
 *
 * Precision rules that shape what is reported:
 *  - **Only negative deltas.** A changed title or a new canonical target is
 *    usually an intentional edit; reporting every change would bury the real
 *    breakages. We report things *disappearing* or *becoming invalid*.
 *  - **Present → absent, not absent → absent.** A field missing in both scans is
 *    a long-standing issue for the normal rules to report, not a regression.
 *  - Findings carry `before`/`after` so the user can see exactly what changed.
 */
export function diffSurfaces(previous: SeoSurface, current: SeoSurface): Finding[] {
  const findings: Finding[] = [];
  const at = (
    issueType: Finding["issueType"],
    severity: Severity,
    message: string,
    before: unknown,
    after: unknown,
  ) => {
    findings.push({
      issueType,
      severity,
      url: current.url,
      ...(current.route ? { route: current.route } : {}),
      message,
      isRegression: true,
      before,
      after,
    });
  };

  // The page itself stopped resolving.
  if (isOk(previous.status) && current.status !== undefined && !isOk(current.status)) {
    at(
      "page_unavailable",
      "high",
      `Page now returns HTTP ${current.status}; it returned ${previous.status} previously.`,
      previous.status,
      current.status,
    );
  }

  // Indexability removed — the most damaging silent regression there is.
  if (previous.robots?.index !== false && current.robots?.index === false) {
    at(
      "noindex_unexpected",
      "high",
      "Page was indexable and is now marked noindex.",
      previous.robots ?? { index: true, follow: true },
      current.robots,
    );
  }

  if (lost(previous.title, current.title)) {
    at("missing_title", "high", "Page had a <title> and now has none.", previous.title, null);
  }

  if (lost(previous.description, current.description)) {
    at(
      "missing_meta_description",
      "medium",
      "Page had a meta description and now has none.",
      previous.description,
      null,
    );
  }

  if (previous.canonical && !current.canonical) {
    at(
      "missing_canonical",
      "high",
      "Page had a canonical URL and now has none.",
      previous.canonical,
      null,
    );
  }

  if (lost(previous.h1Count ? "h1" : undefined, current.h1Count ? "h1" : undefined)) {
    at("missing_h1", "medium", "Page had an <h1> and now has none.", previous.h1Count, 0);
  }

  // Structured data that used to be valid and now is not (or vanished entirely).
  const previousValid = countValidJsonLd(previous);
  const currentValid = countValidJsonLd(current);
  if (previousValid > 0 && currentValid === 0) {
    const currentInvalid = (current.jsonLd ?? []).length > 0;
    at(
      currentInvalid ? "invalid_structured_data" : "missing_structured_data",
      "medium",
      currentInvalid
        ? "Structured data was valid and is now malformed."
        : "Structured data was present and has been removed.",
      previousValid,
      currentValid,
    );
  }

  // Site-level: the sitemap disappeared.
  if (previous.siteWide?.sitemapPresent === true && current.siteWide?.sitemapPresent === false) {
    at(
      "sitemap_missing",
      "medium",
      "Sitemap was reachable previously and is now missing.",
      true,
      false,
    );
  }

  return findings;
}

/** A value counts as lost only if it existed before and is gone now. */
function lost(before: string | undefined, after: string | undefined): boolean {
  return Boolean(before) && !after;
}

function isOk(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 300;
}

function countValidJsonLd(surface: SeoSurface): number {
  return (surface.jsonLd ?? []).filter((block) => block.valid).length;
}
