import type { Finding, SeoSurface } from "@awe/core";

export interface RuleContext {
  /** The page surface being evaluated. */
  surface: SeoSurface;
  /** Prior surface for the same URL, when this scan is a regression check. */
  previous?: SeoSurface;
  /** All surfaces in the current scan, for site-wide checks (e.g. duplicate titles). */
  siteSurfaces?: SeoSurface[];
}

export interface Rule {
  id: string;
  evaluate(ctx: RuleContext): Finding[];
}
