/**
 * The SEO "surface": a normalized, framework-agnostic representation of a page's
 * SEO-relevant output. It is extracted from *rendered HTML*, which is what makes
 * detection universal — the same shape falls out of Next.js, WordPress, Shopify,
 * a .NET site, or a hand-written index.html.
 */
export interface SeoSurface {
  url: string;
  /** Grouped route pattern when known, e.g. "/blog/:slug". */
  route?: string;
  /** HTTP status observed when fetching the page. */
  status?: number;
  title?: string;
  description?: string;
  /** null = explicitly absent; undefined = not yet determined. */
  canonical?: string | null;
  robots?: RobotsDirective;
  openGraph?: Record<string, string>;
  twitter?: Record<string, string>;
  jsonLd?: JsonLdBlock[];
  h1Count?: number;
  hreflang?: HreflangEntry[];
  /**
   * Outbound links found on the page (absolute http(s), deduped). Used by the
   * broken-link check, which is an opt-in I/O step — the surface only records the
   * targets, never their status, so it stays a pure snapshot of the markup.
   */
  links?: string[];
  /** Property-level facts fetched once per site, not per page. */
  siteWide?: SiteWideSurface;
}

export interface SiteWideSurface {
  /** False when robots.txt could not be fetched at all. */
  robotsTxtPresent: boolean;
  /** True when robots.txt disallows everything for the default user-agent. */
  robotsTxtBlocksAll?: boolean;
  sitemapPresent: boolean;
  sitemapUrlCount?: number;
}

export interface RobotsDirective {
  index: boolean;
  follow: boolean;
}

export interface JsonLdBlock {
  type: string;
  valid: boolean;
  errors?: string[];
  /** The block's original script contents — kept so a reasoner can repair it. */
  raw?: string;
}

export interface HreflangEntry {
  lang: string;
  href: string;
}
