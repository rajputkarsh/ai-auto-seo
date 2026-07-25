import type {
  CmsEntry,
  FieldKind,
  FieldWrite,
  PlatformAdapter,
  PlatformContext,
  WriteResult,
} from "./adapter";

export interface WordPressConfig {
  /** Site base URL, e.g. https://blog.example.com */
  baseUrl: string;
  /** Full Authorization header value (e.g. "Basic <app-password>" or "Bearer <token>"). */
  authHeader: string;
  fetchImpl?: typeof fetch;
}

interface WpPost {
  id: number;
  link: string;
}

/**
 * WordPress adapter over the REST API.
 *
 * Wired but **not exercised against a live site** — it needs a real WordPress
 * install + application password, which the dev machine doesn't have. HTTP is
 * injectable, so request shapes (entry lookup by slug, the PATCH payload per
 * field) are unit-tested; the round-trip is verified in deployment.
 *
 * Draft note: WordPress core REST cannot stage a field change without
 * publishing, so `draft` writes go to plugin-convention meta keys and return the
 * edit-screen URL for review. Reliable native drafts want a companion plugin
 * (tracked in the Phase-4 doc); this adapter is honest about that boundary.
 */
export class WordPressPlatform implements PlatformAdapter {
  readonly platform = "wordpress";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: WordPressConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async resolveEntry(url: string): Promise<CmsEntry | null> {
    const slug = slugOf(url);
    if (!slug) return null;
    for (const type of ["pages", "posts"] as const) {
      const hits = await this.wp<WpPost[]>(
        `/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}`,
      );
      const first = hits[0];
      if (first) return { entryId: String(first.id), type };
    }
    return null;
  }

  async writeField(
    entry: CmsEntry,
    write: FieldWrite,
    opts: { draft: boolean },
    _ctx?: PlatformContext,
  ): Promise<WriteResult> {
    const body = payloadFor(write);
    await this.wp(`/wp-json/wp/v2/${entry.type}/${entry.entryId}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      ok: true,
      ...(opts.draft
        ? {
            reviewUrl: `${this.config.baseUrl}/wp-admin/post.php?post=${entry.entryId}&action=edit`,
          }
        : {}),
    };
  }

  private async wp<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: this.config.authHeader,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`WordPress ${path} -> ${res.status}`);
    return res.json() as Promise<T>;
  }
}

/** Map a CMS-neutral field write onto a WordPress REST payload. */
export function payloadFor(write: FieldWrite): Record<string, unknown> {
  const metaFor: Partial<Record<FieldKind, string>> = {
    // Yoast/RankMath conventions; a companion plugin registers these for REST.
    description: "_yoast_wpseo_metadesc",
    canonical: "_yoast_wpseo_canonical",
    robots: "_yoast_wpseo_meta-robots-noindex",
  };
  if (write.kind === "title") return { title: write.value };
  const key = metaFor[write.kind];
  return key ? { meta: { [key]: write.value } } : {};
}

function slugOf(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const seg = path.split("/").filter(Boolean).pop();
    return seg ?? null;
  } catch {
    return null;
  }
}
