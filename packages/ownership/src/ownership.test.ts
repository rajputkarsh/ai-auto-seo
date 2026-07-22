import { describe, expect, it } from "vitest";
import { normalizeHost, VERIFICATION_KEY, verificationToken } from "./token";
import { metaTokenFrom, type VerificationDeps, verifyOwnership } from "./verify";

const SECRET = "test-secret";

describe("verificationToken", () => {
  it("is deterministic for the same host", () => {
    expect(verificationToken("https://ex.com/a", SECRET)).toBe(
      verificationToken("https://ex.com/b", SECRET),
    );
  });

  it("treats www and bare host as the same property", () => {
    expect(verificationToken("https://www.ex.com", SECRET)).toBe(
      verificationToken("https://ex.com", SECRET),
    );
  });

  it("differs per host and per secret", () => {
    expect(verificationToken("https://a.com", SECRET)).not.toBe(
      verificationToken("https://b.com", SECRET),
    );
    expect(verificationToken("https://a.com", SECRET)).not.toBe(
      verificationToken("https://a.com", "other-secret"),
    );
  });
});

describe("normalizeHost", () => {
  it("lowercases, strips www, and tolerates a bare domain", () => {
    expect(normalizeHost("HTTPS://WWW.Ex.COM/path")).toBe("ex.com");
    expect(normalizeHost("ex.com")).toBe("ex.com");
  });
});

describe("metaTokenFrom", () => {
  it("reads the token in either attribute order", () => {
    expect(metaTokenFrom(`<meta name="${VERIFICATION_KEY}" content="abc123" />`)).toBe("abc123");
    expect(metaTokenFrom(`<meta content="abc123" name="${VERIFICATION_KEY}">`)).toBe("abc123");
  });

  it("returns undefined when absent", () => {
    expect(metaTokenFrom("<meta name='description' content='x'>")).toBeUndefined();
  });
});

const token = verificationToken("https://ex.com", SECRET);

const deps = (over: Partial<VerificationDeps> = {}): VerificationDeps => ({
  fetchText: async () => "",
  resolveTxt: async () => [],
  ...over,
});

describe("verifyOwnership", () => {
  it("verifies via a meta tag", async () => {
    const res = await verifyOwnership(
      "https://ex.com",
      token,
      deps({
        fetchText: async () =>
          `<html><head><meta name="${VERIFICATION_KEY}" content="${token}"></head></html>`,
      }),
    );
    expect(res.verified).toBe(true);
    expect(res.method).toBe("meta");
  });

  it("verifies via the well-known file", async () => {
    const res = await verifyOwnership(
      "https://ex.com/some/page",
      token,
      deps({
        fetchText: async (url) => (url.includes(".well-known") ? `${token}\n` : "<html></html>"),
      }),
    );
    expect(res.verified).toBe(true);
    expect(res.method).toBe("file");
  });

  it("verifies via a DNS TXT record, joining split chunks", async () => {
    const res = await verifyOwnership(
      "https://ex.com",
      token,
      deps({
        resolveTxt: async () => [["other=1"], [`${VERIFICATION_KEY}=`, token]],
      }),
    );
    expect(res.verified).toBe(true);
    expect(res.method).toBe("dns");
  });

  it("rejects a wrong token and reports every attempt", async () => {
    const res = await verifyOwnership(
      "https://ex.com",
      token,
      deps({
        fetchText: async () => `<meta name="${VERIFICATION_KEY}" content="not-the-token">`,
        resolveTxt: async () => [["nope"]],
      }),
    );
    expect(res.verified).toBe(false);
    expect(res.method).toBeUndefined();
    expect(res.attempts.map((a) => a.method)).toEqual(["meta", "file", "dns"]);
  });

  it("does not throw when the network or DNS fails", async () => {
    const res = await verifyOwnership(
      "https://ex.com",
      token,
      deps({
        fetchText: async () => {
          throw new Error("ENOTFOUND");
        },
        resolveTxt: async () => {
          throw new Error("DNS timeout");
        },
      }),
    );
    expect(res.verified).toBe(false);
    expect(res.attempts.every((a) => a.detail.includes("check failed"))).toBe(true);
  });

  it("can be restricted to a single method", async () => {
    const res = await verifyOwnership(
      "https://ex.com",
      token,
      deps({ resolveTxt: async () => [[`${VERIFICATION_KEY}=${token}`]] }),
      "dns",
    );
    expect(res.verified).toBe(true);
    expect(res.attempts).toHaveLength(1);
  });
});
