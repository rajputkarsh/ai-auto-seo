import { describe, expect, it } from "vitest";
import { checkLinks, isBroken, type LinkProber } from "./links";

describe("isBroken", () => {
  it("treats unreachable (0) and 4xx/5xx as broken, 2xx/3xx as healthy", () => {
    expect(isBroken(0)).toBe(true);
    expect(isBroken(404)).toBe(true);
    expect(isBroken(500)).toBe(true);
    expect(isBroken(200)).toBe(false);
    expect(isBroken(301)).toBe(false);
  });
});

describe("checkLinks", () => {
  it("probes every link and preserves input order", async () => {
    const statuses: Record<string, number> = {
      "https://a/": 200,
      "https://b/": 404,
      "https://c/": 500,
    };
    const prober: LinkProber = async (url) => statuses[url] ?? 0;
    const result = await checkLinks(Object.keys(statuses), { prober, concurrency: 2 });
    expect(result).toEqual([
      { url: "https://a/", status: 200 },
      { url: "https://b/", status: 404 },
      { url: "https://c/", status: 500 },
    ]);
  });

  it("maps a throwing probe to status 0 rather than failing the whole check", async () => {
    const prober: LinkProber = async (url) => {
      if (url === "https://boom/") throw new Error("network down");
      return 200;
    };
    const result = await checkLinks(["https://ok/", "https://boom/"], { prober });
    expect(result).toEqual([
      { url: "https://ok/", status: 200 },
      { url: "https://boom/", status: 0 },
    ]);
  });

  it("respects the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const prober: LinkProber = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return 200;
    };
    await checkLinks(
      Array.from({ length: 10 }, (_, i) => `https://x/${i}`),
      { prober, concurrency: 3 },
    );
    expect(peak).toBeLessThanOrEqual(3);
  });
});
