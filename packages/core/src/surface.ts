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
}

export interface RobotsDirective {
  index: boolean;
  follow: boolean;
}

export interface JsonLdBlock {
  type: string;
  valid: boolean;
  errors?: string[];
}

export interface HreflangEntry {
  lang: string;
  href: string;
}
