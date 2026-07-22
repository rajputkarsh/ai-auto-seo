import { describe, expect, it } from "vitest";
import { loadConfig } from "./index";

describe("loadConfig", () => {
  it("applies defaults for an empty environment", () => {
    const cfg = loadConfig({});
    expect(cfg.NODE_ENV).toBe("development");
    expect(cfg.PORT).toBe(3000);
    expect(cfg.LOG_LEVEL).toBe("info");
  });

  it("coerces PORT from a string", () => {
    expect(loadConfig({ PORT: "8080" }).PORT).toBe(8080);
  });

  it("throws a readable error on an invalid value", () => {
    expect(() => loadConfig({ LOG_LEVEL: "chatty" })).toThrow(/Invalid environment configuration/);
    expect(() => loadConfig({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });

  it("accepts valid optional values", () => {
    const cfg = loadConfig({
      DATABASE_URL: "postgresql://localhost:5432/awe",
      NODE_ENV: "production",
    });
    expect(cfg.DATABASE_URL).toBe("postgresql://localhost:5432/awe");
    expect(cfg.NODE_ENV).toBe("production");
  });
});
