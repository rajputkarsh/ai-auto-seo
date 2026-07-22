import type { JsonLdBlock, RobotsDirective, SeoSurface } from "@awe/core";
import * as cheerio from "cheerio";

type CheerioAPI = cheerio.CheerioAPI;

/**
 * Extract the normalized SEO surface from a page's rendered HTML.
 *
 * This function is intentionally framework-blind: it reads output only, so it
 * works identically for any stack. Give it the final rendered HTML (e.g. from a
 * headless browser) and the page URL.
 */
export function extractSurface(html: string, url: string, status = 200): SeoSurface {
  const $ = cheerio.load(html);

  const title = firstText($("head > title").first().text());
  const description = attrText($, 'meta[name="description"]', "content");
  const canonicalRaw = attrText($, 'link[rel="canonical"]', "href");
  const canonical = canonicalRaw === undefined ? null : resolveUrl(canonicalRaw, url);
  const robots = parseRobots(attrText($, 'meta[name="robots"]', "content"));
  const openGraph = collectMeta($, "property", /^og:/i);
  const twitter = collectMeta($, "name", /^twitter:/i);
  const jsonLd = extractJsonLd($);
  const hreflang = collectHreflang($);

  const surface: SeoSurface = {
    url,
    status,
    canonical,
    h1Count: $("h1").length,
  };
  if (title) surface.title = title;
  if (description) surface.description = description;
  if (robots) surface.robots = robots;
  if (Object.keys(openGraph).length) surface.openGraph = openGraph;
  if (Object.keys(twitter).length) surface.twitter = twitter;
  if (jsonLd.length) surface.jsonLd = jsonLd;
  if (hreflang.length) surface.hreflang = hreflang;
  return surface;
}

/**
 * Resolve a possibly-relative URL against the page URL.
 *
 * Relative canonicals (`/pricing`) are valid HTML and are resolved by search
 * engines, so they must NOT be reported as malformed. Resolving here keeps that
 * false positive out of the rules entirely. Genuinely unusable values (e.g.
 * `javascript:`) survive resolution with a non-http protocol and are left for
 * the rule to flag.
 */
function resolveUrl(href: string, pageUrl: string): string {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return href; // unresolvable — hand the raw value to the rule
  }
}

function firstText(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

function attrText($: CheerioAPI, selector: string, attr: string): string | undefined {
  return firstText($(selector).first().attr(attr));
}

function parseRobots(content: string | undefined): RobotsDirective | undefined {
  if (!content) return undefined;
  const tokens = content
    .toLowerCase()
    .split(",")
    .map((t) => t.trim());
  return {
    index: !tokens.includes("noindex") && !tokens.includes("none"),
    follow: !tokens.includes("nofollow") && !tokens.includes("none"),
  };
}

function collectMeta(
  $: CheerioAPI,
  attr: "name" | "property",
  pattern: RegExp,
): Record<string, string> {
  const out: Record<string, string> = {};
  $(`meta[${attr}]`).each((_, el) => {
    const key = $(el).attr(attr);
    const content = $(el).attr("content");
    if (key && content != null && pattern.test(key)) out[key.toLowerCase()] = content;
  });
  return out;
}

function collectHreflang($: CheerioAPI) {
  const out: { lang: string; href: string }[] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang");
    const href = $(el).attr("href");
    if (lang && href) out.push({ lang, href });
  });
  return out;
}

function extractJsonLd($: CheerioAPI): JsonLdBlock[] {
  const blocks: JsonLdBlock[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      blocks.push({ type: "Unknown", valid: false, errors: ["invalid JSON"] });
      return;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      if (node && typeof node === "object" && "@type" in node) {
        const rawType = (node as Record<string, unknown>)["@type"];
        blocks.push({ type: typeof rawType === "string" ? rawType : "Unknown", valid: true });
      } else {
        blocks.push({ type: "Unknown", valid: false, errors: ["missing @type"] });
      }
    }
  });
  return blocks;
}
