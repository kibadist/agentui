// ─── SVG / DOM construction helpers ──────────────────────────────────────────
//
// Small, dependency-free helpers for building SVG scenes imperatively. Kept
// deliberately tiny — no virtual DOM. Components rebuild their scene subtree on
// data change; for the scene sizes these components target (tens of nodes) this
// is more than fast enough and keeps the code transparent.

const SVG_NS = "http://www.w3.org/2000/svg";

type SvgAttrs = Record<string, string | number | boolean | null | undefined>;

/** Create an SVG element with attributes applied. `false`/`null`/`undefined` skip. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: SvgAttrs = {},
  children: (Node | string)[] = [],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  for (const child of children) {
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

/** Create a plain HTML element with attributes applied. */
export function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: SvgAttrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const child of children) {
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function setAttrs(el: Element, attrs: SvgAttrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    el.setAttribute(key, String(value));
  }
}

/** Remove all children of a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Truncate text to a maximum character budget, appending an ellipsis. We avoid
 * DOM text measurement (getComputedTextLength) so layout stays deterministic
 * and works under jsdom, where measurement is not implemented.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return text.slice(0, max - 1).trimEnd() + "…";
}

/** Build a cubic-bezier path string between two points with horizontal easing. */
export function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = Math.abs(x2 - x1);
  const c = Math.max(24, dx * 0.5);
  return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
}

/** Build a straight line path string. */
export function linePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}
