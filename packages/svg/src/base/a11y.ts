// ─── Accessibility helpers ───────────────────────────────────────────────────
//
// SVG has weak built-in accessibility, so interactive scene parts are made
// reachable and operable explicitly:
//   * `tabindex="0"` to enter the tab order (or "-1" for roving tabindex),
//   * a `role` (usually "button" or "option") so AT announces affordance,
//   * an `aria-label` because SVG shapes have no implicit accessible name,
//   * Enter / Space activation wired by the base element's event delegation.
//
// Caveat: focusable SVG elements are not reliably focusable in every browser.
// We set tabindex on the element and rely on `:focus-visible` styling; for the
// broadest support, interactive parts are <g>/<rect> shapes with explicit roles.

/** Mark an element as an interactive, keyboard-activatable target. */
export interface InteractiveOptions {
  /** Accessible name announced by assistive tech. Required for SVG shapes. */
  label: string;
  /** ARIA role. Defaults to "button". */
  role?: string;
  /** Whether the element is currently selected (sets aria-selected). */
  selected?: boolean;
  /** Disabled affordances are skipped by activation and marked aria-disabled. */
  disabled?: boolean;
  /** Use -1 for roving tabindex managed by the container; 0 for normal order. */
  tabindex?: 0 | -1;
}

/**
 * Apply the standard interactive attribute set to an SVG/HTML element. The
 * element must also carry a `data-activate` marker (added here) so the base
 * element's delegated click/keydown handlers recognise it.
 */
export function makeInteractive(el: Element, opts: InteractiveOptions): void {
  el.setAttribute("data-activate", "");
  el.setAttribute("role", opts.role ?? "button");
  el.setAttribute("aria-label", opts.label);
  el.setAttribute("tabindex", String(opts.tabindex ?? 0));
  if (opts.selected !== undefined) {
    el.setAttribute("aria-selected", String(opts.selected));
  }
  if (opts.disabled) {
    el.setAttribute("aria-disabled", "true");
  }
}

/** True for keys that should activate an interactive element. */
export function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

/** Find the nearest ancestor (or self) that is an activation target. */
export function closestActivatable(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const match = target.closest("[data-activate]");
  if (!match) return null;
  if (match.getAttribute("aria-disabled") === "true") return null;
  return match;
}
