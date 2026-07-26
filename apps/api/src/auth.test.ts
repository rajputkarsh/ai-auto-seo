import { type ApiKeyStore, InMemoryApiKeyStore } from "@awe/auth";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orgOf, registerAuth } from "./auth";

/** A tiny app: the auth hook + one protected route + one public-looking route. */
async function buildApp(mode: "dev" | "apikey", store: ApiKeyStore): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerAuth(app, { store, mode });
  app.get("/protected", async (req) => ({ org: orgOf(req) }));
  app.get("/healthz", async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("API auth hook", () => {
  let store: InMemoryApiKeyStore;
  let key: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    store = new InMemoryApiKeyStore();
    key = (await store.create({ orgId: "acme", role: "owner" })).plaintext;
  });
  afterEach(async () => {
    await app?.close();
  });

  describe("apikey mode (production enforcement)", () => {
    beforeEach(async () => {
      app = await buildApp("apikey", store);
    });

    it("401s a request with no credentials", async () => {
      const res = await app.inject({ method: "GET", url: "/protected" });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("unauthorized");
    });

    it("ignores the x-awe-org header entirely — no more stand-in", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { "x-awe-org": "acme" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("authenticates a valid API key and resolves its org", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${key}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().org).toBe("acme");
    });

    it("401s a revoked key", async () => {
      const keyId = (await store.list("acme"))[0]!.id;
      await store.revoke(keyId);
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: `Bearer ${key}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it("leaves public routes open", async () => {
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
    });

    it("whoami echoes the authenticated identity", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/auth/whoami",
        headers: { authorization: `Bearer ${key}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ orgId: "acme", role: "owner", via: "apikey" });
    });
  });

  describe("dev mode (local convenience)", () => {
    beforeEach(async () => {
      app = await buildApp("dev", store);
    });

    it("trusts x-awe-org when no key is presented", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { "x-awe-org": "globex" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().org).toBe("globex");
    });

    it("defaults the org when no header is present", async () => {
      const res = await app.inject({ method: "GET", url: "/protected" });
      expect(res.statusCode).toBe(200);
      expect(res.json().org).toBe("default");
    });

    it("still 401s an explicitly wrong key", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: "Bearer awe_wrong" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
