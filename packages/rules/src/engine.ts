import type { Finding, SeoSurface } from "@awe/core";
import type { Rule } from "./rule";
import { canonicalRule } from "./rules/canonical";
import { headingRule } from "./rules/heading";
import { metaDescriptionRule } from "./rules/meta";
import { robotsRule } from "./rules/robots";
import { siteWideRule } from "./rules/sitewide";
import { structuredDataRule } from "./rules/structured-data";
import { titleRule } from "./rules/title";

/** The default rule set. Rules are deterministic and cheap — the precision workhorse. */
export const defaultRules: Rule[] = [
  titleRule,
  metaDescriptionRule,
  canonicalRule,
  robotsRule,
  structuredDataRule,
  headingRule,
  siteWideRule,
];

export interface EvaluateOptions {
  /** Prior surfaces keyed by URL, to enable regression findings. */
  previous?: Record<string, SeoSurface>;
  rules?: Rule[];
}

/** Run the rule set across one scan's worth of page surfaces. */
export function evaluate(surfaces: SeoSurface[], opts: EvaluateOptions = {}): Finding[] {
  const rules = opts.rules ?? defaultRules;
  const findings: Finding[] = [];
  for (const surface of surfaces) {
    for (const rule of rules) {
      findings.push(
        ...rule.evaluate({
          surface,
          previous: opts.previous?.[surface.url],
          siteSurfaces: surfaces,
        }),
      );
    }
  }
  return findings;
}
