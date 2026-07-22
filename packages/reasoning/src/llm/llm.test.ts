import type { Finding, SeoSurface } from "@awe/core";
import { describe, expect, it } from "vitest";
import { CAPABLE_MODEL, CHEAP_MODEL, type LlmCall, type LlmClient } from "./client";
import { CostGovernor, costCents } from "./cost";
import { createLlmReasoner, type LlmReasonerEvent } from "./reasoner";

const surface: SeoSurface = { url: "https://shop.example.com/products/kettle", canonical: null };

const finding = (over: Partial<Finding>): Finding => ({
  issueType: "missing_title",
  severity: "high",
  url: surface.url,
  message: "no title",
  ...over,
});

/** Records calls and returns canned values, so no API key or network is needed. */
function stubClient(
  respond: (call: LlmCall<unknown>) => unknown,
  usage = { inputTokens: 1000, outputTokens: 100 },
): LlmClient & { calls: LlmCall<unknown>[] } {
  const calls: LlmCall<unknown>[] = [];
  return {
    calls,
    async call<T>(request: LlmCall<T>) {
      calls.push(request as LlmCall<unknown>);
      return { value: respond(request as LlmCall<unknown>) as T, usage, model: request.model };
    },
  };
}

describe("costCents", () => {
  it("prices the capable model 5x the cheap one for the same tokens", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    expect(costCents(CAPABLE_MODEL, usage)).toBeCloseTo(500);
    expect(costCents(CHEAP_MODEL, usage)).toBeCloseTo(100);
  });

  it("charges output tokens at the higher rate", () => {
    expect(costCents(CHEAP_MODEL, { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(500);
  });

  it("prices an unknown model at the most expensive rate rather than free", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    expect(costCents("some-future-model", usage)).toBeCloseTo(500);
  });
});

describe("CostGovernor", () => {
  it("tracks spend and remaining budget", () => {
    const g = new CostGovernor(100);
    g.record(CHEAP_MODEL, { inputTokens: 1_000_000, outputTokens: 0 }); // 100 cents
    expect(g.spentCents).toBeCloseTo(100);
    expect(g.remainingCents).toBeCloseTo(0);
    expect(g.callCount).toBe(1);
  });

  it("refuses further spend once exhausted", () => {
    const g = new CostGovernor(50);
    expect(g.canAfford()).toBe(true);
    g.record(CHEAP_MODEL, { inputTokens: 1_000_000, outputTokens: 0 });
    expect(g.canAfford()).toBe(false);
  });
});

describe("createLlmReasoner — routing", () => {
  it("uses the CAPABLE model to author a title", async () => {
    const client = stubClient(() => ({ value: "Pour-Over Kettle | Example Shop", rationale: "r" }));
    const reasoner = createLlmReasoner({ client, governor: new CostGovernor(1000) });

    const instruction = await reasoner.reason(finding({}), surface);

    expect(client.calls[0]?.model).toBe(CAPABLE_MODEL);
    expect(instruction.canonicalFix.html).toBe("<title>Pour-Over Kettle | Example Shop</title>");
    expect(instruction.targetSurfaceChange.title).toBe("Pour-Over Kettle | Example Shop");
  });

  it("uses the CHEAP model for the ambiguous noindex judgement", async () => {
    const client = stubClient(() => ({ likelyIntentional: false, reason: "product page" }));
    const reasoner = createLlmReasoner({ client, governor: new CostGovernor(1000) });

    await reasoner.reason(finding({ issueType: "noindex_unexpected" }), surface);

    expect(client.calls[0]?.model).toBe(CHEAP_MODEL);
  });

  it("spends NOTHING on issues the rules already answer", async () => {
    const client = stubClient(() => ({}));
    const governor = new CostGovernor(1000);
    const events: LlmReasonerEvent[] = [];
    const reasoner = createLlmReasoner({ client, governor, onEvent: (e) => events.push(e) });

    await reasoner.reason(finding({ issueType: "missing_canonical" }), surface);

    expect(client.calls).toHaveLength(0);
    expect(governor.spentCents).toBe(0);
    expect(events[0]?.route).toBe("deterministic");
  });

  it("passes page text through so copy is grounded in real content", async () => {
    const client = stubClient(() => ({
      value: "A Gooseneck Kettle For Pour-Over",
      rationale: "r",
    }));
    const reasoner = createLlmReasoner({ client, governor: new CostGovernor(1000) });

    await reasoner.reason(finding({}), surface, { pageText: "A gooseneck kettle." });

    expect(client.calls[0]?.user).toContain("A gooseneck kettle.");
  });
});

describe("createLlmReasoner — failing soft", () => {
  const deterministicTitle = "<title>Kettle</title>";

  it("falls back to deterministic output when over budget", async () => {
    const client = stubClient(() => ({ value: "Should never be used", rationale: "r" }));
    const governor = new CostGovernor(0);
    const reasoner = createLlmReasoner({ client, governor });

    const instruction = await reasoner.reason(finding({}), surface);

    expect(client.calls).toHaveLength(0);
    expect(instruction.canonicalFix.html).toBe(deterministicTitle);
  });

  it("falls back when the model call throws", async () => {
    const client: LlmClient = {
      async call() {
        throw new Error("503 overloaded");
      },
    };
    const events: LlmReasonerEvent[] = [];
    const reasoner = createLlmReasoner({
      client,
      governor: new CostGovernor(1000),
      onEvent: (e) => events.push(e),
    });

    const instruction = await reasoner.reason(finding({}), surface);

    expect(instruction.canonicalFix.html).toBe(deterministicTitle);
    expect(events[0]?.reason).toContain("model call failed");
  });

  it("rejects generated copy that breaks the length bounds", async () => {
    const client = stubClient(() => ({ value: "Too short", rationale: "r" }));
    const reasoner = createLlmReasoner({ client, governor: new CostGovernor(1000) });

    const instruction = await reasoner.reason(finding({}), surface);

    // Falls back rather than shipping an out-of-bounds title.
    expect(instruction.canonicalFix.html).toBe(deterministicTitle);
  });

  it("still charges for a call whose output it rejects", async () => {
    const client = stubClient(() => ({ value: "Too short", rationale: "r" }));
    const governor = new CostGovernor(1000);
    await createLlmReasoner({ client, governor }).reason(finding({}), surface);
    expect(governor.spentCents).toBeGreaterThan(0);
  });
});

describe("createLlmReasoner — safety of generated text", () => {
  it("HTML-escapes generated copy before it can become a patch", async () => {
    const client = stubClient(() => ({
      value:
        'Kettles & "Gear" <script>alert(1)</script> for pour-over brewing, roasting and everyday coffee at home.',
      rationale: "r",
    }));
    const reasoner = createLlmReasoner({ client, governor: new CostGovernor(1000) });

    const instruction = await reasoner.reason(
      finding({ issueType: "missing_meta_description", severity: "medium" }),
      surface,
    );

    const html = instruction.canonicalFix.html ?? "";
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;Gear&quot;");
    expect(html).toContain("&amp;");
  });
});

describe("createLlmReasoner — ambiguity handling", () => {
  it("downgrades confidence when a noindex looks deliberate", async () => {
    const client = stubClient(() => ({
      likelyIntentional: true,
      reason: "checkout confirmation page",
    }));
    const reasoner = createLlmReasoner({ client, governor: new CostGovernor(1000) });

    const instruction = await reasoner.reason(
      finding({ issueType: "noindex_unexpected" }),
      surface,
    );

    expect(instruction.confidence).toBeLessThanOrEqual(0.4);
    expect(instruction.expectedImpact).toBe("Low");
    expect(instruction.whyItMatters).toContain("checkout confirmation page");
  });

  it("leaves confidence intact when the noindex looks accidental", async () => {
    const client = stubClient(() => ({ likelyIntentional: false, reason: "primary content" }));
    const reasoner = createLlmReasoner({ client, governor: new CostGovernor(1000) });

    const instruction = await reasoner.reason(
      finding({ issueType: "noindex_unexpected" }),
      surface,
    );

    expect(instruction.confidence).toBeGreaterThan(0.9);
  });
});
