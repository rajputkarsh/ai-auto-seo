import { describe, expect, it } from "vitest";
import { bearerToken, resolveIdentity } from "./resolve";
import { InMemoryApiKeyStore } from "./store";

describe("bearerToken", () => {
  it("extracts the token from a Bearer header, case-insensitively", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer   spaced ")).toBe("spaced");
    expect(bearerToken(["Bearer first", "Bearer second"])).toBe("first");
  });

  it("returns null for absent or non-bearer headers", () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("")).toBeNull();
  });
});

describe("resolveIdentity", () => {
  async function seed() {
    const store = new InMemoryApiKeyStore();
    const { plaintext } = await store.create({ orgId: "acme", role: "member" });
    return { store, plaintext };
  }

  it("a valid API key wins in either mode", async () => {
    const { store, plaintext } = await seed();
    for (const mode of ["dev", "apikey"] as const) {
      const id = await resolveIdentity({ mode, store, authorization: `Bearer ${plaintext}` });
      expect(id).toMatchObject({ orgId: "acme", role: "member", via: "apikey" });
    }
  });

  it("apikey mode rejects a request with no credentials (the real enforcement)", async () => {
    const { store } = await seed();
    const id = await resolveIdentity({ mode: "apikey", store, devOrgHeader: "acme" });
    expect(id).toBeNull(); // x-awe-org is ignored in production mode
  });

  it("dev mode trusts x-awe-org when no key is presented", async () => {
    const { store } = await seed();
    const id = await resolveIdentity({ mode: "dev", store, devOrgHeader: "globex" });
    expect(id).toEqual({ orgId: "globex", role: "owner", via: "dev" });
  });

  it("dev mode defaults the org when even the header is absent", async () => {
    const { store } = await seed();
    const id = await resolveIdentity({ mode: "dev", store });
    expect(id).toEqual({ orgId: "default", role: "owner", via: "dev" });
  });

  it("an explicitly presented invalid key fails in BOTH modes (not treated as anonymous)", async () => {
    const { store } = await seed();
    for (const mode of ["dev", "apikey"] as const) {
      const id = await resolveIdentity({
        mode,
        store,
        authorization: "Bearer awe_wrong-key",
        devOrgHeader: "acme",
      });
      expect(id).toBeNull();
    }
  });
});
