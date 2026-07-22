import * as cheerio from "cheerio";

/**
 * Extract a page's visible text, truncated.
 *
 * Used to give a model enough page context to write real copy (a title, a meta
 * description) instead of guessing from the URL slug. Script, style, and nav
 * chrome are dropped so the budget is spent on actual content.
 */
export function extractText(html: string, maxChars = 2000): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
