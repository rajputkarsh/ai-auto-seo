import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@awe/config": r("./packages/config/src/index.ts"),
      "@awe/core": r("./packages/core/src/index.ts"),
      "@awe/crawler": r("./packages/crawler/src/index.ts"),
      "@awe/eval": r("./packages/eval/src/index.ts"),
      "@awe/extractor": r("./packages/extractor/src/index.ts"),
      "@awe/logger": r("./packages/logger/src/index.ts"),
      "@awe/pipeline": r("./packages/pipeline/src/index.ts"),
      "@awe/reasoning": r("./packages/reasoning/src/index.ts"),
      "@awe/remediation": r("./packages/remediation/src/index.ts"),
      "@awe/rules": r("./packages/rules/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
