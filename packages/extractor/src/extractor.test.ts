import { describe, expect, it } from "vitest";
import { extractSurface } from "./extractor";

const FULL = `<!doctype html>
<html>
  <head>
    <title>  Best Coffee Beans  </title>
    <meta name="description" content="Freshly roasted beans." />
    <link rel="canonical" href="https://ex.com/coffee" />
    <meta name="robots" content="index, follow" />
    <meta property="og:title" content="Best Coffee" />
    <meta name="twitter:card" content="summary" />
    <link rel="alternate" hreflang="fr" href="https://ex.com/fr/coffee" />
    <script type="application/ld+json">{"@type":"Product","name":"Beans"}</script>
  </head>
  <body><h1>Coffee</h1></body>
</html>`;

describe("extractSurface", () => {
  it("extracts and normalizes core SEO fields from rendered HTML", () => {
    const s = extractSurface(FULL, "https://ex.com/coffee");
    expect(s.title).toBe("Best Coffee Beans");
    expect(s.description).toBe("Freshly roasted beans.");
    expect(s.canonical).toBe("https://ex.com/coffee");
    expect(s.robots).toEqual({ index: true, follow: true });
    expect(s.openGraph).toEqual({ "og:title": "Best Coffee" });
    expect(s.twitter).toEqual({ "twitter:card": "summary" });
    expect(s.jsonLd).toEqual([{ type: "Product", valid: true }]);
    expect(s.hreflang).toEqual([{ lang: "fr", href: "https://ex.com/fr/coffee" }]);
    expect(s.h1Count).toBe(1);
  });

  it("reports canonical=null when absent and detects noindex", () => {
    const s = extractSurface(
      `<html><head><meta name="robots" content="noindex"></head><body></body></html>`,
      "https://ex.com/x",
    );
    expect(s.canonical).toBeNull();
    expect(s.title).toBeUndefined();
    expect(s.robots).toEqual({ index: false, follow: true });
    expect(s.h1Count).toBe(0);
  });

  it("flags invalid JSON-LD rather than throwing", () => {
    const s = extractSurface(
      `<html><head><script type="application/ld+json">{oops}</script></head><body></body></html>`,
      "https://ex.com/y",
    );
    expect(s.jsonLd?.[0]?.valid).toBe(false);
  });

  it("works on markup with no head metadata at all", () => {
    const s = extractSurface(`<html><body><h1>a</h1><h1>b</h1></body></html>`, "https://ex.com/z");
    expect(s.title).toBeUndefined();
    expect(s.description).toBeUndefined();
    expect(s.canonical).toBeNull();
    expect(s.h1Count).toBe(2);
  });
});
