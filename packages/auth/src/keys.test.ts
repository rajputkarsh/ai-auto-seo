import { describe, expect, it } from "vitest";
import { API_KEY_PREFIX, generateApiKey, hashApiKey, looksLikeApiKey } from "./keys";

describe("API key generation", () => {
  it("mints prefixed, high-entropy, unique keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(a.plaintext.length).toBeGreaterThan(24);
    expect(a.plaintext).not.toBe(b.plaintext);
  });

  it("returns the hash of the plaintext, never the plaintext itself, for storage", () => {
    const key = generateApiKey();
    expect(key.hash).toBe(hashApiKey(key.plaintext));
    expect(key.hash).not.toContain(key.plaintext);
    // sha256 hex is 64 chars.
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("display fragment reveals neither the middle nor enough to reconstruct", () => {
    const key = generateApiKey();
    expect(key.display).toContain("…");
    expect(key.display.length).toBeLessThan(key.plaintext.length);
  });

  it("recognises its own key shape and rejects foreign bearers", () => {
    expect(looksLikeApiKey(generateApiKey().plaintext)).toBe(true);
    expect(looksLikeApiKey("Bearer something")).toBe(false);
    expect(looksLikeApiKey("awe_")).toBe(false); // prefix alone is too short
    expect(looksLikeApiKey("")).toBe(false);
  });
});
