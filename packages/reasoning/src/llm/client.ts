// The Anthropic SDK's zod helper is typed against `zod/v4` (shipped as a
// subpath of zod 3.25+). Schemas handed to it must come from the same surface,
// or they fail to typecheck at the boundary.
import type * as z from "zod/v4";
import type { TokenUsage } from "./cost";

/** Model IDs this package routes between. */
export const CHEAP_MODEL = "claude-haiku-4-5";
export const CAPABLE_MODEL = "claude-opus-4-8";

export interface LlmCall<T> {
  model: string;
  system: string;
  user: string;
  /** Response is constrained to this schema via structured outputs. */
  schema: z.ZodType<T>;
  maxTokens: number;
  /**
   * Reasoning effort. Only supported on the capable model — Haiku 4.5 rejects
   * the parameter, so the adapter omits it there.
   */
  effort?: "low" | "medium" | "high";
}

export interface LlmResult<T> {
  value: T;
  usage: TokenUsage;
  model: string;
}

/**
 * Minimal seam over the model provider.
 *
 * Everything above this interface is provider-agnostic and unit-testable with a
 * stub, so the reasoner's routing, validation, budget and fallback logic are all
 * verifiable without an API key or a network call.
 */
export interface LlmClient {
  call<T>(request: LlmCall<T>): Promise<LlmResult<T>>;
}
