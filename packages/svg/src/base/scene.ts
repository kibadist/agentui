// ─── SVG scene helper ────────────────────────────────────────────────────────
//
// Builds a configured <svg> root with the shared <defs> injected, plus a <g>
// "viewport" group that pan/zoom transforms (when a component supports them).
// Returns both so the component appends scene content into `viewport`.

import { svg } from "./dom.js";
import { buildDefs } from "../styles/defs.js";

export interface SvgScene {
  svg: SVGSVGElement;
  /** Group that scene content goes into; transformed for pan/zoom. */
  viewport: SVGGElement;
  defs: SVGDefsElement;
}

export interface SceneOptions {
  /** viewBox width in user units. */
  width: number;
  /** viewBox height in user units. */
  height: number;
  /** Accessible label for the whole scene. */
  label: string;
  /** ARIA role for the svg; defaults to "group". */
  role?: string;
  /** preserveAspectRatio value; defaults to "xMidYMid meet". */
  preserveAspectRatio?: string;
}

export function createScene(opts: SceneOptions): SvgScene {
  const root = svg("svg", {
    viewBox: `0 0 ${opts.width} ${opts.height}`,
    preserveAspectRatio: opts.preserveAspectRatio ?? "xMidYMid meet",
    role: opts.role ?? "group",
    "aria-label": opts.label,
    focusable: "false",
  });
  const defs = buildDefs();
  const viewport = svg("g", { "data-viewport": "" });
  root.append(defs, viewport);
  return { svg: root, viewport, defs };
}
