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
  SENTRY_DSN: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof schema>;

/** Parse and validate an environment. Throws a readable error when invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(env);
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
