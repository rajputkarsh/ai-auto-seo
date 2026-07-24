import { describe, expect, it } from "vitest";
import { createScanStore } from "./factory";
import { InMemoryScanStore } from "./memory";

describe("createScanStore", () => {
  it("returns the in-memory store when no DATABASE_URL is configured", async () => {
    expect(await createScanStore({})).toBeInstanceOf(InMemoryScanStore);
    expect(await createScanStore({ databaseUrl: undefined })).toBeInstanceOf(InMemoryScanStore);
  });

  it("returns a working store that satisfies the contract", async () => {
    const store = await createScanStore({});
    await store.saveScan({
      propertyId: "x.com",
      surfaces: [{ url: "https://x.com/", title: "T" }],
    });
    expect((await store.latestSurfaces("x.com"))["https://x.com/"]?.title).toBe("T");
  });

  // The DATABASE_URL branch dynamically imports @prisma/client and constructs a
  // real client; it is exercised at runtime (API boot with DATABASE_URL set),
  // not here, so the unit suite needs no generated client or database.
});
