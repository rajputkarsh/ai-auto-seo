import type { FrameworkAdapter } from "./adapter";
import { nextjsAdapter } from "./nextjs";
import { staticHtmlAdapter } from "./static-html";

/**
 * Adapter order matters: the most specific framework wins. Next.js is tried
 * before static-HTML because a Next repo may also contain stray `.html` files.
 */
export const adapters: FrameworkAdapter[] = [nextjsAdapter, staticHtmlAdapter];

/** The first adapter that recognises the repository, or null if none do. */
export async function detectFramework(repoRoot: string): Promise<FrameworkAdapter | null> {
  for (const adapter of adapters) {
    if (await adapter.detect(repoRoot)) return adapter;
  }
  return null;
}
