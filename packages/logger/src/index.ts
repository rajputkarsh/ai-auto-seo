import { getConfig } from "@awe/config";
import pino, { type Logger } from "pino";

export type { Logger };

/** Structured JSON logger, one child per service/component. */
export function createLogger(name: string): Logger {
  return pino({ name, level: getConfig().LOG_LEVEL });
}

type ErrorReporter = (error: unknown, context?: Record<string, unknown>) => void;

let reporter: ErrorReporter | undefined;

/**
 * Seam for error tracking. Phase 2 can register a Sentry (or other) reporter
 * here without touching any call site; until then reporting is log-only.
 */
export function setErrorReporter(fn: ErrorReporter): void {
  reporter = fn;
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (reporter) {
    reporter(error, context);
    return;
  }
  createLogger("error").error({ err: error, ...context }, "unhandled error");
}
