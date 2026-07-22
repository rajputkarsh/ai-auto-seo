import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractSurface } from "@awe/extractor";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR, loadCases } from "./harness";

/**
 * Snapshot every fixture's extracted SeoSurface.
 *
 * The eval gate proves the *rules* behave; this proves the *extractor* does.
 * Any change to extraction shows up as a reviewable diff here rather than
 * silently shifting what every rule sees. Update deliberately with `-u`.
 */
describe("SeoSurface snapshots", () => {
  for (const golden of loadCases()) {
    for (const page of golden.pages) {
      it(`${golden.name} / ${page.file}`, () => {
        const html = readFileSync(join(FIXTURES_DIR, golden.name, page.file), "utf8");
        expect(extractSurface(html, page.url)).toMatchSnapshot();
      });
    }
  }
});
