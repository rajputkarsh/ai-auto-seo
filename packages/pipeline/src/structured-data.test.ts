import type { LlmCall, LlmClient } from "@awe/reasoning";
import { CostGovernor, createLlmReasoner } from "@awe/reasoning";
import { describe, expect, it } from "vitest";
import { runScan } from "./pipeline";

/**
 * A page that is healthy except for one broken JSON-LD block (missing a closing
 * brace / bad syntax). The deterministic path can only advise; the LLM path can
 * author a corrected block, which the patch gate then verifies.
 */
const BROKEN_JSONLD = `<!doctype html><html><head>
  <title>Blue Widget | Acme</title>
  <meta name="description" content="The Acme blue widget, in stock and ready to ship."/>
  <link rel="canonical" href="https://acme.com/widget"/>
  <script type="application/ld+json">{ "@type": "Product", "name": "Blue Widget", }</script>
</head><body><h1>Blue Widget</h1></body></html>`;

/** Stub LLM that returns a corrected JSON-LD string for the repair call. */
function repairClient(jsonLd: string): LlmClient {
  return {
    async call<T>(request: LlmCall<T>) {
      return {
        value: {
          jsonLd,
          rationale: "Added the missing @context and removed the trailing comma.",
        } as T,
        usage: { inputTokens: 500, outputTokens: 120 },
        model: request.model,
      };
    },
  };
}

describe("invalid_structured_data auto-fix (LLM path)", () => {
  it("produces a verified replace-patch from the model's corrected JSON-LD", async () => {
    const reasoner = createLlmReasoner({
      client: repairClient(
        '{"@context":"https://schema.org","@type":"Product","name":"Blue Widget"}',
      ),
      governor: new CostGovernor(100),
    });

    const result = await runScan(BROKEN_JSONLD, "https://acme.com/widget", { reasoner });
    const item = result.items.find((i) => i.finding.issueType === "invalid_structured_data");
    expect(item).toBeDefined();
    // A real, verified patch was produced (the fixed block re-extracts as valid).
    expect(item?.patch).toBeDefined();
    expect(item?.patch).toContain("application/ld+json");
  });

  it("falls back to guidance when the model returns JSON that is still invalid", async () => {
    const reasoner = createLlmReasoner({
      // No @type → not valid JSON-LD → the repair is rejected.
      client: repairClient('{"name":"Blue Widget"}'),
      governor: new CostGovernor(100),
    });

    const result = await runScan(BROKEN_JSONLD, "https://acme.com/widget", { reasoner });
    const item = result.items.find((i) => i.finding.issueType === "invalid_structured_data");
    expect(item).toBeDefined();
    expect(item?.patch).toBeUndefined();
    expect(item?.patchUnavailable).toBeDefined();
  });

  it("without an LLM, the deterministic path stays recommendation-only", async () => {
    const result = await runScan(BROKEN_JSONLD, "https://acme.com/widget");
    const item = result.items.find((i) => i.finding.issueType === "invalid_structured_data");
    expect(item?.patch).toBeUndefined();
  });
});
