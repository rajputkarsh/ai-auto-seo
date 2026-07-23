import type { SeoSurface } from "@awe/core";
import { describe, expect, it } from "vitest";
import { InMemoryScanStore } from "./memory";
import { propertyIdFromUrl } from "./store";

const surface = (url: string, title?: string): SeoSurface => ({
  url,
  canonical: url,
  ...(title ? { title } : {}),
});

describe("propertyIdFromUrl", () => {
  it("treats www and bare host, and any path, as one property", () => {
    expect(propertyIdFromUrl("https://www.Example.com/a/b?c=1")).toBe("example.com");
    expect(propertyIdFromUrl("https://example.com")).toBe("example.com");
    expect(propertyIdFromUrl("example.com")).toBe("example.com");
  });

  it("keeps distinct hosts separate", () => {
    expect(propertyIdFromUrl("https://a.com")).not.toBe(propertyIdFromUrl("https://b.com"));
  });
});

describe("InMemoryScanStore", () => {
  it("returns nothing for a property never scanned", async () => {
    const store = new InMemoryScanStore();
    expect(await store.latestSurfaces("x.com")).toEqual({});
    expect(await store.listScans("x.com")).toEqual([]);
  });

  it("round-trips surfaces from a saved scan", async () => {
    const store = new InMemoryScanStore();
    await store.saveScan({ propertyId: "x.com", surfaces: [surface("https://x.com/a", "A")] });

    const latest = await store.latestSurfaces("x.com");
    expect(latest["https://x.com/a"]?.title).toBe("A");
  });

  it("returns the NEWEST surface for a URL scanned repeatedly", async () => {
    const store = new InMemoryScanStore();
    await store.saveScan({
      propertyId: "x.com",
      surfaces: [surface("https://x.com/a", "Old")],
      scannedAt: new Date("2026-01-01"),
    });
    await store.saveScan({
      propertyId: "x.com",
      surfaces: [surface("https://x.com/a", "New")],
      scannedAt: new Date("2026-02-01"),
    });

    const latest = await store.latestSurfaces("x.com");
    expect(latest["https://x.com/a"]?.title).toBe("New");
  });

  it("keeps a page's history when a later scan omits it", async () => {
    // A page dropped by crawl budget or a transient failure must not lose the
    // last state we saw it in, or its next regression check has no baseline.
    const store = new InMemoryScanStore();
    await store.saveScan({
      propertyId: "x.com",
      surfaces: [surface("https://x.com/a", "A"), surface("https://x.com/b", "B")],
      scannedAt: new Date("2026-01-01"),
    });
    await store.saveScan({
      propertyId: "x.com",
      surfaces: [surface("https://x.com/a", "A2")],
      scannedAt: new Date("2026-02-01"),
    });

    const latest = await store.latestSurfaces("x.com");
    expect(latest["https://x.com/a"]?.title).toBe("A2");
    expect(latest["https://x.com/b"]?.title).toBe("B");
  });

  it("isolates properties from each other", async () => {
    const store = new InMemoryScanStore();
    await store.saveScan({ propertyId: "a.com", surfaces: [surface("https://a.com/", "A")] });
    await store.saveScan({ propertyId: "b.com", surfaces: [surface("https://b.com/", "B")] });

    expect(Object.keys(await store.latestSurfaces("a.com"))).toEqual(["https://a.com/"]);
    expect(Object.keys(await store.latestSurfaces("b.com"))).toEqual(["https://b.com/"]);
  });

  it("does not let later mutation of a caller's surface rewrite history", async () => {
    const store = new InMemoryScanStore();
    const live = surface("https://x.com/a", "Original");
    await store.saveScan({ propertyId: "x.com", surfaces: [live] });

    live.title = "Mutated after save";

    const latest = await store.latestSurfaces("x.com");
    expect(latest["https://x.com/a"]?.title).toBe("Original");
  });

  it("lists scans newest-first with counts", async () => {
    const store = new InMemoryScanStore();
    await store.saveScan({
      propertyId: "x.com",
      surfaces: [surface("https://x.com/a")],
      issueCount: 3,
      scannedAt: new Date("2026-01-01"),
    });
    await store.saveScan({
      propertyId: "x.com",
      surfaces: [surface("https://x.com/a"), surface("https://x.com/b")],
      issueCount: 1,
      scannedAt: new Date("2026-02-01"),
    });

    const scans = await store.listScans("x.com");
    expect(scans).toHaveLength(2);
    expect(scans[0]?.pageCount).toBe(2);
    expect(scans[0]?.issueCount).toBe(1);
    expect(scans[1]?.issueCount).toBe(3);
  });

  it("honours the list limit", async () => {
    const store = new InMemoryScanStore();
    for (let i = 0; i < 5; i++) {
      await store.saveScan({
        propertyId: "x.com",
        surfaces: [surface("https://x.com/a")],
        scannedAt: new Date(2026, 0, i + 1),
      });
    }
    expect(await store.listScans("x.com", 2)).toHaveLength(2);
  });
});
