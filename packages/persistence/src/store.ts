import type { SeoSurface } from "@awe/core";

export interface ScanSummary {
  id: string;
  propertyId: string;
  scannedAt: Date;
  pageCount: number;
  issueCount: number;
}

export interface SaveScanInput {
  propertyId: string;
  surfaces: SeoSurface[];
  issueCount?: number;
  scannedAt?: Date;
}

/**
 * Storage for scan history.
 *
 * This is what turns one-off scans into monitoring: `latestSurfaces` supplies
 * the "before" side of a regression comparison, so a caller no longer has to
 * hand-carry the previous state. The interface is deliberately small — two
 * writes and two reads — so an in-memory implementation is a first-class option
 * for local runs and tests, not a stub.
 */
export interface ScanStore {
  saveScan(input: SaveScanInput): Promise<ScanSummary>;

  /**
   * The most recent surface for each URL of a property, keyed by URL.
   *
   * Latest-per-URL rather than latest-scan: a page missing from the most recent
   * crawl (budget, transient failure) should still be compared against the last
   * time it *was* seen, instead of silently losing its history.
   */
  latestSurfaces(propertyId: string): Promise<Record<string, SeoSurface>>;

  listScans(propertyId: string, limit?: number): Promise<ScanSummary[]>;
}

/** Stable property identity: the registrable host, lowercased and www-stripped. */
export function propertyIdFromUrl(url: string): string {
  const parsed = new URL(url.includes("://") ? url : `https://${url}`);
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}
