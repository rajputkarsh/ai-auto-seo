import { createHash, randomBytes } from "node:crypto";

/** Every issued key carries this prefix, so a leaked key is greppable in logs/repos. */
export const API_KEY_PREFIX = "awe_";

export interface GeneratedApiKey {
  /** The full secret — shown to the user exactly once, never stored. */
  plaintext: string;
  /** SHA-256 of the plaintext; this is what the store persists and looks up by. */
  hash: string;
  /** A safe-to-display fragment (`awe_1a2b…z9`) for listing keys after creation. */
  display: string;
}

/**
 * Mint a new API key.
 *
 * 24 random bytes → 32 base64url chars of entropy, well beyond guessing range.
 * We return the hash alongside the plaintext because the store must persist ONLY
 * the hash: a database leak then exposes no usable credential, and there is no
 * "recover my key" path by design — a lost key is revoked and reissued.
 */
export function generateApiKey(): GeneratedApiKey {
  const plaintext = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { plaintext, hash: hashApiKey(plaintext), display: displayFor(plaintext) };
}

/** SHA-256 hex of a key. Deterministic, so the presented key hashes to its stored row. */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Cheap shape check before hashing/looking up — a bearer that isn't ours can't be a key. */
export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length > API_KEY_PREFIX.length + 8;
}

/** `awe_1a2b…z9y8` — enough to recognise a key without revealing it. */
export function displayFor(plaintext: string): string {
  return `${plaintext.slice(0, 8)}…${plaintext.slice(-4)}`;
}
