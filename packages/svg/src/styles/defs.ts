// ─── Shared SVG <defs>: filters, gradients, markers ──────────────────────────
//
// SVG `url(#id)` references resolve within the same tree, and inside shadow DOM
// that means the SAME shadow root. So every component injects its own copy of
// these defs into its SVG root. Ids are prefixed (`agentui-`) to avoid clashes
// with host-page defs when a component is ever rendered in light DOM.
//
// When to use CSS filters vs SVG filters:
//   * CSS `filter: drop-shadow(...)` — cheap, good for simple element shadows,
//     but cannot be referenced/reused and clips to the element box.
//   * SVG `<filter>` (here) — reusable across many nodes via `filter="url(#…)"`,
//     supports compositing (glow = blur + merge), and is controllable per-node.
// These components use the SVG filters below for node elevation + active glow,
// and CSS drop-shadow for one-off HTML overlays.

import { svg } from "../base/dom.js";

export const DEFS_IDS = {
  softShadow: "agentui-soft-shadow",
  glow: "agentui-glow",
  blur: "agentui-blur",
} as const;

/**
 * Build a `<defs>` element containing the shared filters. Call once per SVG
 * root and prepend it to the root.
 */
export function buildDefs(): SVGDefsElement {
  const defs = svg("defs");

  // Soft drop shadow for node elevation.
  const soft = svg("filter", {
    id: DEFS_IDS.softShadow,
    x: "-30%",
    y: "-30%",
    width: "160%",
    height: "160%",
    "color-interpolation-filters": "sRGB",
  });
  soft.append(
    svg("feDropShadow", {
      dx: 0,
      dy: 1,
      stdDeviation: 2,
      "flood-color": "#0f172a",
      "flood-opacity": 0.18,
    }),
  );
  defs.append(soft);

  // Glow used to emphasise the active node/state: blur the alpha, tint it with
  // the accent, then composite the source on top.
  const glow = svg("filter", {
    id: DEFS_IDS.glow,
    x: "-50%",
    y: "-50%",
    width: "200%",
    height: "200%",
    "color-interpolation-filters": "sRGB",
  });
  glow.append(
    svg("feGaussianBlur", { in: "SourceAlpha", stdDeviation: 3, result: "blur" }),
    // flood-color is themed via a CSS rule on `.agentui-glow-flood` (see
    // BASE_CSS) — `var()` does NOT resolve as an XML presentation attribute, so
    // the static fill here is only the fallback when that CSS is absent.
    svg("feFlood", { class: "agentui-glow-flood", "flood-color": "#6366f1", result: "color" }),
    svg("feComposite", { in: "color", in2: "blur", operator: "in", result: "glow" }),
    (() => {
      const merge = svg("feMerge");
      merge.append(
        svg("feMergeNode", { in: "glow" }),
        svg("feMergeNode", { in: "SourceGraphic" }),
      );
      return merge;
    })(),
  );
  defs.append(glow);

  // Plain blur, occasionally useful for de-emphasising background context.
  const blur = svg("filter", { id: DEFS_IDS.blur });
  blur.append(svg("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 1.5 }));
  defs.append(blur);

  return defs;
}
