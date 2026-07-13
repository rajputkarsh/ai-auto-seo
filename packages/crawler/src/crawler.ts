import type { SeoSurface } from "@awe/core";
import { extractSurface } from "@awe/extractor";

export interface CrawlResult {
  surface: SeoSurface;
  html: string;
}

/**
 * Render a URL in headless Chromium and extract its SEO surface.
 *
 * Rendering (not a raw fetch) is what makes detection universal: client-rendered
 * SPAs produce their final DOM only after JS runs, and this captures that output.
 *
 * NOTE: requires a Chromium binary. With `playwright-core` you must provision one
 * (e.g. `npx playwright install chromium`) and pass its path, or inject a browser.
 * The fetchCrawl() fallback below works for server-rendered/static pages with no
 * browser at all.
 */
export async function crawl(url: string): Promise<CrawlResult> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const resp = await page.goto(url, { waitUntil: "networkidle" });
    const html = await page.content();
    const status = resp?.status() ?? 0;
    return { surface: extractSurface(html, url, status), html };
  } finally {
    await browser.close();
  }
}

/** Zero-dependency fallback: fetch raw HTML. Works for SSR/static, not CSR. */
export async function fetchCrawl(url: string): Promise<CrawlResult> {
  const resp = await fetch(url);
  const html = await resp.text();
  return { surface: extractSurface(html, url, resp.status), html };
}
