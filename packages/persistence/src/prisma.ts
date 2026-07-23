import type { SeoSurface } from "@awe/core";
import type { SaveScanInput, ScanStore, ScanSummary } from "./store";

/**
 * The subset of the generated Prisma client this store uses.
 *
 * Declaring it structurally means the package typechecks and its tests run
 * without anyone having executed `prisma generate` first — the generated client
 * is only needed to actually talk to a database.
 */
export interface PrismaLike {
  property: {
    upsert(args: {
      where: { host: string };
      create: { host: string };
      update: Record<string, never>;
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  scan: {
    create(args: {
      data: {
        propertyId: string;
        scannedAt: Date;
        pageCount: number;
        issueCount: number;
        surfaces: { create: { url: string; surface: unknown }[] };
      };
      select: { id: true; scannedAt: true; pageCount: true; issueCount: true };
    }): Promise<{ id: string; scannedAt: Date; pageCount: number; issueCount: number }>;
    findMany(args: {
      where: { property: { host: string } };
      orderBy: { scannedAt: "desc" };
      take: number;
      select: { id: true; scannedAt: true; pageCount: true; issueCount: true };
    }): Promise<{ id: string; scannedAt: Date; pageCount: number; issueCount: number }[]>;
  };
  pageSurface: {
    findMany(args: {
      where: { scan: { property: { host: string } } };
      orderBy: { scan: { scannedAt: "asc" } };
      select: { url: true; surface: true };
    }): Promise<{ url: string; surface: unknown }[]>;
  };
}

/**
 * Postgres-backed scan history.
 *
 * Mirrors `InMemoryScanStore` exactly, so swapping between them is a
 * configuration decision (DATABASE_URL present or not) rather than a code path.
 */
export class PrismaScanStore implements ScanStore {
  constructor(private readonly prisma: PrismaLike) {}

  async saveScan(input: SaveScanInput): Promise<ScanSummary> {
    // Upsert keeps the caller from having to register a property first.
    const property = await this.prisma.property.upsert({
      where: { host: input.propertyId },
      create: { host: input.propertyId },
      update: {},
      select: { id: true },
    });

    const scan = await this.prisma.scan.create({
      data: {
        propertyId: property.id,
        scannedAt: input.scannedAt ?? new Date(),
        pageCount: input.surfaces.length,
        issueCount: input.issueCount ?? 0,
        surfaces: {
          create: input.surfaces.map((surface) => ({ url: surface.url, surface })),
        },
      },
      select: { id: true, scannedAt: true, pageCount: true, issueCount: true },
    });

    return { ...scan, propertyId: input.propertyId };
  }

  async latestSurfaces(propertyId: string): Promise<Record<string, SeoSurface>> {
    // Ordered oldest-first so later rows overwrite earlier ones, leaving the
    // newest surface per URL — matching the in-memory store's semantics.
    const rows = await this.prisma.pageSurface.findMany({
      where: { scan: { property: { host: propertyId } } },
      orderBy: { scan: { scannedAt: "asc" } },
      select: { url: true, surface: true },
    });

    const latest: Record<string, SeoSurface> = {};
    for (const row of rows) {
      latest[row.url] = row.surface as SeoSurface;
    }
    return latest;
  }

  async listScans(propertyId: string, limit = 20): Promise<ScanSummary[]> {
    const scans = await this.prisma.scan.findMany({
      where: { property: { host: propertyId } },
      orderBy: { scannedAt: "desc" },
      take: limit,
      select: { id: true, scannedAt: true, pageCount: true, issueCount: true },
    });
    return scans.map((scan) => ({ ...scan, propertyId }));
  }
}
