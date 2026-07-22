import { CAPABLE_MODEL, type LlmCall, type LlmClient, type LlmResult } from "./client";

/**
 * Real provider adapter.
 *
 * The SDK is imported lazily so that merely importing `@awe/reasoning` — which
 * every service does, for the deterministic path — never loads it. Only actually
 * calling a model pays that cost.
 *
 * Model-specific rules encoded here (each is a 400-level error otherwise):
 *  - Opus 4.8 runs WITHOUT thinking unless `thinking` is set explicitly, and
 *    rejects temperature/top_p/top_k outright — so adaptive thinking is passed
 *    and no sampling parameters are sent.
 *  - Haiku 4.5 does not support `output_config.effort`; the field is omitted for
 *    any non-capable model.
 *  - Both models support structured outputs, so responses are schema-constrained
 *    rather than parsed out of prose.
 */
export function createAnthropicClient(apiKey?: string): LlmClient {
  let loaded: Promise<LoadedSdk> | undefined;

  const load = (): Promise<LoadedSdk> => {
    loaded ??= (async () => {
      const [sdk, zodHelpers] = await Promise.all([
        import("@anthropic-ai/sdk"),
        import("@anthropic-ai/sdk/helpers/zod"),
      ]);
      const Anthropic = sdk.default;
      return {
        client: apiKey ? new Anthropic({ apiKey }) : new Anthropic(),
        zodOutputFormat: zodHelpers.zodOutputFormat,
      };
    })();
    return loaded;
  };

  return {
    async call<T>(request: LlmCall<T>): Promise<LlmResult<T>> {
      const { client, zodOutputFormat } = await load();
      const isCapable = request.model === CAPABLE_MODEL;

      const response = await client.messages.parse({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        // Opus 4.8 does not think unless told to; Haiku has no adaptive mode.
        ...(isCapable ? { thinking: { type: "adaptive" as const } } : {}),
        output_config: {
          format: zodOutputFormat(request.schema),
          ...(isCapable && request.effort ? { effort: request.effort } : {}),
        },
      });

      if (response.parsed_output == null) {
        throw new Error(`Model ${request.model} returned no parseable output`);
      }

      return {
        value: response.parsed_output as T,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        model: response.model,
      };
    },
  };
}

interface LoadedSdk {
  client: import("@anthropic-ai/sdk").default;
  zodOutputFormat: typeof import("@anthropic-ai/sdk/helpers/zod").zodOutputFormat;
}
