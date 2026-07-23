import type { SeoSurface } from "@awe/core";
import type { SaveScanInput, ScanStore, ScanSummary } from "./store";

interface StoredScan extends ScanSummary {
  surfaces: SeoSurface[];
}

/**
 * In-memory scan history.
 *
 * Not a test double: this is the default store when no DATABASE_URL is set, so
 * the product works — including regression detection within a session — before
 * anyone provisions Postgres. History is lost on restart, which is the whole
 * difference from the Prisma store.
 */
export class InMemoryScanStore implements ScanStore {
  private readonly scans = new Map<string, StoredScan[]>();
  private sequence = 0;

  async saveScan(input: SaveScanInput): Promise<ScanSummary> {
    const scan: StoredScan = {
      id: `scan_${++this.sequence}`,
      propertyId: input.propertyId,
      scannedAt: input.scannedAt ?? new Date(),
      pageCount: input.surfaces.length,
      issueCount: input.issueCount ?? 0,
      // Copy so later mutation of the caller's surfaces cannot rewrite history.
      surfaces: input.surfaces.map((surface) => structuredClone(surface)),
    };

    const history = this.scans.get(input.propertyId);
    if (history) history.push(scan);
    else this.scans.set(input.propertyId, [scan]);

    return summarize(scan);
  }

  async latestSurfaces(propertyId: string): Promise<Record<string, SeoSurface>> {
    const history = this.scans.get(propertyId) ?? [];
    const latest: Record<string, SeoSurface> = {};
    const seenAt: Record<string, number> = {};

    for (const scan of history) {
      const time = scan.scannedAt.getTime();
      for (const surface of scan.surfaces) {
        const previous = seenAt[surface.url];
        if (previous === undefined || time >= previous) {
          latest[surface.url] = surface;
          seenAt[surface.url] = time;
        }
      }
    }
    return latest;
  }

  async listScans(propertyId: string, limit = 20): Promise<ScanSummary[]> {
    return (this.scans.get(propertyId) ?? [])
      .slice()
      .sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime())
      .slice(0, limit)
      .map(summarize);
  }

  /** Test/ops helper — drop all history. */
  clear(): void {
    this.scans.clear();
  }
}

function summarize(scan: StoredScan): ScanSummary {
  return {
    id: scan.id,
    propertyId: scan.propertyId,
    scannedAt: scan.scannedAt,
    pageCount: scan.pageCount,
    issueCount: scan.issueCount,
  };
}
