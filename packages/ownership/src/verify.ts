import { normalizeHost, VERIFICATION_KEY, WELL_KNOWN_PATH } from "./token";

export type VerificationMethod = "meta" | "dns" | "file";

export interface VerificationResult {
  verified: boolean;
  /** Which proof succeeded, when one did. */
  method?: VerificationMethod;
  /** Per-method outcome, for showing the user what to fix. */
  attempts: { method: VerificationMethod; verified: boolean; detail: string }[];
}

/**
 * Injectable I/O so verification is testable without network or DNS. Phase 2
 * wires these to the real crawler and node:dns.
 */
export interface VerificationDeps {
  fetchText: (url: string) => Promise<string>;
  resolveTxt: (host: string) => Promise<string[][]>;
}

/**
 * Check that the requester controls the property, by any one of three proofs.
 *
 * Verification gates *scheduled* crawling, not one-off scans of a single URL —
 * we should not repeatedly crawl a site on someone's behalf without evidence
 * they own it.
 */
export async function verifyOwnership(
  url: string,
  token: string,
  deps: VerificationDeps,
  only?: VerificationMethod,
): Promise<VerificationResult> {
  const methods: VerificationMethod[] = only ? [only] : ["meta", "file", "dns"];
  const attempts: VerificationResult["attempts"] = [];

  for (const method of methods) {
    const attempt = await runMethod(method, url, token, deps);
    attempts.push(attempt);
    if (attempt.verified) return { verified: true, method, attempts };
  }
  return { verified: false, attempts };
}

async function runMethod(
  method: VerificationMethod,
  url: string,
  token: string,
  deps: VerificationDeps,
): Promise<{ method: VerificationMethod; verified: boolean; detail: string }> {
  try {
    switch (method) {
      case "meta": {
        const html = await deps.fetchText(url);
        const found = metaTokenFrom(html);
        return {
          method,
          verified: found === token,
          detail: found ? `found meta token ${mask(found)}` : "no verification meta tag found",
        };
      }
      case "file": {
        const origin = new URL(url).origin;
        const body = await deps.fetchText(`${origin}${WELL_KNOWN_PATH}`);
        const found = body.trim();
        return {
          method,
          verified: found === token,
          detail: found ? `file contained ${mask(found)}` : "verification file was empty",
        };
      }
      case "dns": {
        const records = await deps.resolveTxt(normalizeHost(url));
        const values = records.map((chunks) => chunks.join(""));
        const match = values.find((v) => v.trim() === `${VERIFICATION_KEY}=${token}`);
        return {
          method,
          verified: match !== undefined,
          detail: match
            ? "matching TXT record found"
            : `${values.length} TXT record(s), none match`,
        };
      }
    }
  } catch (error) {
    return { method, verified: false, detail: `check failed: ${describe(error)}` };
  }
}

/** Extract the verification token from a page's markup. */
export function metaTokenFrom(html: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]*name=["']${VERIFICATION_KEY}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const reversed = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${VERIFICATION_KEY}["']`,
    "i",
  );
  return html.match(pattern)?.[1] ?? html.match(reversed)?.[1];
}

function mask(token: string): string {
  return token.length <= 8 ? token : `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
