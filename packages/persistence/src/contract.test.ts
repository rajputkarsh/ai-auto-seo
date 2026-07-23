import type { SeoSurface } from "@awe/core";
import { describe, expect, it } from "vitest";
import { InMemoryScanStore } from "./memory";
import { type PrismaLike, PrismaScanStore } from "./prisma";
import type { ScanStore } from "./store";

const surface = (url: string, title?: string): SeoSurface => ({
  url,
  canonical: url,
  ...(title ? { title } : {}),
});

/**
 * Minimal working fake of the Prisma surface this store uses. It really stores
 * rows and honours the documented ordering, so the store's query shapes and
 * latest-per-URL logic are exercised for real — just without Postgres.
 */
class FakePrisma implements PrismaLike {
  private properties = new Map<string, string>();
  private scans: {
    id: string;
    host: string;
    scannedAt: Date;
    pageCount: number;
    issueCount: number;
  }[] = [];
  private surfaces: { scanId: string; url: string; surface: unknown }[] = [];
  private sequence = 0;

  property = {
    upsert: async (args: { where: { host: string } }) => {
      const existing = this.properties.get(args.where.host);
      if (existing) return { id: existing };
      const id = `prop_${++this.sequence}`;
      this.properties.set(args.where.host, id);
      return { id };
    },
  };

  scan = {
    create: async (args: {
      data: {
        propertyId: string;
        scannedAt: Date;
        pageCount: number;
        issueCount: number;
        surfaces: { create: { url: string; surface: unknown }[] };
      };
    }) => {
      const host = [...this.properties.entries()].find(
        ([, id]) => id === args.data.propertyId,
      )?.[0];
      const id = `scan_${++this.sequence}`;
      this.scans.push({
        id,
        host: host ?? "",
        scannedAt: args.data.scannedAt,
        pageCount: args.data.pageCount,
        issueCount: args.data.issueCount,
      });
      for (const row of args.data.surfaces.create) {
        this.surfaces.push({ scanId: id, url: row.url, surface: row.surface });
      }
      return {
        id,
        scannedAt: args.data.scannedAt,
        pageCount: args.data.pageCount,
        issueCount: args.data.issueCount,
      };
    },
    findMany: async (args: { where: { property: { host: string } }; take: number }) =>
      this.scans
        .filter((s) => s.host === args.where.property.host)
        .sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime())
        .slice(0, args.take)
        .map(({ id, scannedAt, pageCount, issueCount }) => ({
          id,
          scannedAt,
          pageCount,
          issueCount,
        })),
  };

  pageSurface = {
    findMany: async (args: { where: { scan: { property: { host: string } } } }) => {
      const host = args.where.scan.property.host;
      const scanTimes = new Map(this.scans.map((s) => [s.id, s]));
      return this.surfaces
        .filter((row) => scanTimes.get(row.scanId)?.host === host)
        .sort(
          (a, b) =>
            (scanTimes.get(a.scanId)?.scannedAt.getTime() ?? 0) -
            (scanTimes.get(b.scanId)?.scannedAt.getTime() ?? 0),
        )
        .map(({ url, surface: s }) => ({ url, surface: s }));
    },
  };
}

/**
 * Both stores must behave identically — swapping them is a configuration
 * choice (DATABASE_URL set or not), so any divergence would be a bug that only
 * appears in one deployment.
 */
const implementations: [string, () => ScanStore][] = [
  ["InMemoryScanStore", () => new InMemoryScanStore()],
  ["PrismaScanStore", () => new PrismaScanStore(new FakePrisma())],
];

describe.each(implementations)("ScanStore contract: %s", (_name, create) => {
  it("returns nothing for an unknown property", async () => {
    const store = create();
    expect(await store.latestSurfaces("x.com")).toEqual({});
    expect(await store.listScans("x.com")).toEqual([]);
  });

  it("round-trips a saved surface", async () => {
    const store = create();
    await store.saveScan({ propertyId: "x.com", surfaces: [surface("https://x.com/a", "A")] });
    expect((await store.latestSurfaces("x.com"))["https://x.com/a"]?.title).toBe("A");
  });

  it("returns the newest surface per URL", async () => {
    const store = create();
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
    expect((await store.latestSurfaces("x.com"))["https://x.com/a"]?.title).toBe("New");
  });

  it("keeps a page's last known state when a later scan omits it", async () => {
    const store = create();
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

  it("isolates properties", async () => {
    const store = create();
    await store.saveScan({ propertyId: "a.com", surfaces: [surface("https://a.com/")] });
    await store.saveScan({ propertyId: "b.com", surfaces: [surface("https://b.com/")] });
    expect(Object.keys(await store.latestSurfaces("a.com"))).toEqual(["https://a.com/"]);
  });

  it("lists scans newest-first with counts", async () => {
    const store = create();
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
    expect(scans.map((s) => s.issueCount)).toEqual([1, 3]);
    expect(scans[0]?.pageCount).toBe(2);
  });
});
