import { describe, expect, it } from "vitest";
import { InMemoryPrOutcomeStore } from "./outcomes";

const opened = (
  store: InMemoryPrOutcomeStore,
  over: Partial<Parameters<InMemoryPrOutcomeStore["recordOpened"]>[0]> = {},
) =>
  store.recordOpened({
    orgId: "acme",
    repo: "acme/site",
    prNumber: 1,
    url: "memory://acme/site/pull/1",
    issueType: "missing_canonical",
    ...over,
  });

describe("InMemoryPrOutcomeStore", () => {
  it("starts a fresh store at a zero merge-rate", async () => {
    const store = new InMemoryPrOutcomeStore();
    expect(await store.mergeRate()).toEqual({
      opened: 0,
      merged: 0,
      mergedUnedited: 0,
      dismissed: 0,
      mergeRateWithoutEdits: 0,
    });
  });

  it("counts an opened but unresolved PR toward opened, not the rate", async () => {
    const store = new InMemoryPrOutcomeStore();
    await opened(store);
    const rate = await store.mergeRate();
    expect(rate.opened).toBe(1);
    expect(rate.mergeRateWithoutEdits).toBe(0); // nothing resolved yet
  });

  it("computes merge-rate-without-edits over RESOLVED PRs only", async () => {
    const store = new InMemoryPrOutcomeStore();
    const a = await opened(store, { prNumber: 1 });
    const b = await opened(store, { prNumber: 2 });
    const c = await opened(store, { prNumber: 3 });
    const d = await opened(store, { prNumber: 4 }); // stays open

    await store.resolve(a.id, "merged_unedited");
    await store.resolve(b.id, "merged_unedited");
    await store.resolve(c.id, "merged_edited");
    // d unresolved

    const rate = await store.mergeRate();
    // 2 unedited / 3 resolved = 0.666…; the open PR is excluded from the ratio.
    expect(rate.opened).toBe(4);
    expect(rate.merged).toBe(3);
    expect(rate.mergedUnedited).toBe(2);
    expect(rate.mergeRateWithoutEdits).toBeCloseTo(2 / 3);
  });

  it("treats a dismissed PR as a resolved miss", async () => {
    const store = new InMemoryPrOutcomeStore();
    const a = await opened(store, { prNumber: 1 });
    const b = await opened(store, { prNumber: 2 });
    await store.resolve(a.id, "merged_unedited");
    await store.resolve(b.id, "dismissed");

    const rate = await store.mergeRate();
    expect(rate.dismissed).toBe(1);
    expect(rate.mergeRateWithoutEdits).toBe(0.5); // 1 unedited / 2 resolved
  });

  it("scopes the rate by org", async () => {
    const store = new InMemoryPrOutcomeStore();
    const a = await opened(store, { orgId: "a", prNumber: 1 });
    const b = await opened(store, { orgId: "b", prNumber: 1 });
    await store.resolve(a.id, "merged_unedited");
    await store.resolve(b.id, "dismissed");

    expect((await store.mergeRate("a")).mergeRateWithoutEdits).toBe(1);
    expect((await store.mergeRate("b")).mergeRateWithoutEdits).toBe(0);
  });

  it("throws on resolving an unknown PR", async () => {
    const store = new InMemoryPrOutcomeStore();
    await expect(store.resolve("nope", "dismissed")).rejects.toThrow(/unknown/);
  });
});
