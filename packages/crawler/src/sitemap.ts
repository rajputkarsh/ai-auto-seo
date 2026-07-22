/** True when the document is a sitemap index (a sitemap of sitemaps). */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** Every `<loc>` entry. Works for both urlset and sitemapindex documents. */
export function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const pattern = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let match = pattern.exec(xml);
  while (match !== null) {
    const value = match[1];
    if (value) urls.push(decodeXmlEntities(value.trim()));
    match = pattern.exec(xml);
  }
  return urls;
}

/** Count `<loc>` entries without materializing them. */
export function countSitemapUrls(sitemapXml: string): number {
  return (sitemapXml.match(/<loc>/gi) ?? []).length;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
