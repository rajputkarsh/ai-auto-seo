import { createHmac } from "node:crypto";

/** The meta tag / DNS TXT key and the well-known file path we look for. */
export const VERIFICATION_KEY = "awe-site-verification";
export const WELL_KNOWN_PATH = `/.well-known/${VERIFICATION_KEY}.txt`;

/**
 * Derive a property's verification token.
 *
 * Deterministic (HMAC of the host under a server secret) rather than random, so
 * a token can be re-derived on demand without storing one — Phase 1 has no
 * datastore. Because it is keyed by a server-side secret, a site owner still
 * cannot guess another property's token. Phase 2 may persist issued tokens for
 * rotation and audit.
 */
export function verificationToken(url: string, secret: string): string {
  return createHmac("sha256", secret).update(normalizeHost(url)).digest("hex").slice(0, 32);
}

/** The registrable host a property is verified against, lowercased and www-stripped. */
export function normalizeHost(url: string): string {
  const parsed = new URL(url.includes("://") ? url : `https://${url}`);
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

/** Copy-paste instructions for each supported proof. */
export function verificationInstructions(url: string, token: string) {
  const host = normalizeHost(url);
  return {
    meta: `<meta name="${VERIFICATION_KEY}" content="${token}" />`,
    dns: `TXT record on ${host}: ${VERIFICATION_KEY}=${token}`,
    file: `Serve ${WELL_KNOWN_PATH} containing: ${token}`,
  };
}
