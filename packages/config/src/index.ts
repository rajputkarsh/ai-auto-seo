import { z } from "zod";

/**
 * Environment schema. Values are validated at startup so a misconfigured
 * deployment fails loudly at boot instead of surfacing as `undefined` deep in a
 * request. Optional entries belong to later phases (persistence, LLM, errors).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Requests per minute per IP. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  /**
   * Secret used to derive property verification tokens. The default is fine for
   * local development but MUST be set in any deployed environment — otherwise
   * anyone can derive another property's token.
   */
  VERIFICATION_SECRET: z.string().min(1).default("dev-only-insecure-secret"),

  // Phase 2+
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Per-scan spend ceiling for the LLM reasoner's cost governor, in cents. */
  LLM_BUDGET_CENTS: z.coerce.number().int().nonnegative().default(25),
  SENTRY_DSN: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof schema>;

/** Parse and validate an environment. Throws a readable error when invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // An empty string is not the same as "unset" to zod — `z.string().url()`
  // rejects "". A blank line in .env (e.g. `DATABASE_URL=`) should mean "use the
  // default / leave optional", so drop empty values before validating.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== ""),
  ) as NodeJS.ProcessEnv;
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: AppConfig | undefined;

/** Memoized config for service entrypoints. */
export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test helper: drop the memoized config. */
export function resetConfig(): void {
  cached = undefined;
}
