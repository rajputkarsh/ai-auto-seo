import type {
  CmsEntry,
  FieldKind,
  FieldWrite,
  PlatformAdapter,
  PlatformContext,
  WriteResult,
} from "./adapter";

interface StoredEntry {
  entryId: string;
  type: string;
  live: Partial<Record<FieldKind, string>>;
}

/**
 * In-memory platform.
 *
 * The default when no real CMS is connected, and a genuine store — not a stub —
 * so the CMS rail's draft/publish/verify flow works end to end locally. A draft
 * write is held separately from the live entry until published, which is exactly
 * the "staged for review" semantics the rail relies on.
 */
export class InMemoryPlatform implements PlatformAdapter {
  readonly platform = "memory";
  private readonly byUrl = new Map<string, StoredEntry>();
  private readonly drafts = new Map<string, Partial<Record<FieldKind, string>>>();

  /** Seed an entry that renders `url`. */
  seed(
    url: string,
    entry: { entryId: string; type: string; live?: Partial<Record<FieldKind, string>> },
  ): void {
    this.byUrl.set(url, { entryId: entry.entryId, type: entry.type, live: entry.live ?? {} });
  }

  async resolveEntry(url: string): Promise<CmsEntry | null> {
    const entry = this.byUrl.get(url);
    return entry ? { entryId: entry.entryId, type: entry.type } : null;
  }

  async writeField(
    entry: CmsEntry,
    write: FieldWrite,
    opts: { draft: boolean },
  ): Promise<WriteResult> {
    if (opts.draft) {
      const draft = this.drafts.get(entry.entryId) ?? {};
      draft[write.kind] = write.value;
      this.drafts.set(entry.entryId, draft);
      return { ok: true, reviewUrl: `memory://review/${entry.entryId}` };
    }
    this.applyLive(entry.entryId, write.kind, write.value);
    return { ok: true };
  }

  /** Approve a staged draft — moves pending changes onto the live entry. */
  publish(entryId: string): void {
    const draft = this.drafts.get(entryId);
    if (!draft) return;
    for (const [kind, value] of Object.entries(draft)) {
      if (value !== undefined) this.applyLive(entryId, kind as FieldKind, value);
    }
    this.drafts.delete(entryId);
  }

  // ---- test/ops inspection ----
  draftFor(entryId: string): Partial<Record<FieldKind, string>> | undefined {
    return this.drafts.get(entryId);
  }
  liveField(url: string, kind: FieldKind): string | undefined {
    return this.byUrl.get(url)?.live[kind];
  }

  private applyLive(entryId: string, kind: FieldKind, value: string): void {
    for (const entry of this.byUrl.values()) {
      if (entry.entryId === entryId) entry.live[kind] = value;
    }
  }
}
