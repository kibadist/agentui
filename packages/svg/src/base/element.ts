// ─── AgentUIElement: shared base for every SVG component ─────────────────────
//
// Responsibilities:
//   * Attach an open shadow root and inject the shared token + base stylesheet
//     plus the subclass's component CSS.
//   * Own a single internal <svg> root (the "scene") for complex components, or
//     leave rendering to the subclass for HTML-leaning ones.
//   * Provide a `.data` property that stores declarative data and schedules a
//     render. Also parse a `data` attribute (JSON) for fully declarative HTML.
//   * Implement ONE delegated pointer + keyboard handler for the whole scene
//     (event delegation), translating clicks / Enter / Space on any element
//     marked `[data-activate]` into a single `onActivate()` call.
//   * Provide `emit()` for bubbling, composed CustomEvents.
//
// Subclasses implement `render()` and `onActivate()`.

import { BASE_CSS, TOKENS_CSS } from "../styles/tokens.js";
import { clear, html } from "./dom.js";
import { closestActivatable, isActivationKey } from "./a11y.js";
import { makeEvent } from "./events.js";

export abstract class AgentUIElement<TData = unknown> extends HTMLElement {
  protected readonly root: ShadowRoot;
  /** Container that subclasses render into (svg or html lives under here). */
  protected readonly mount: HTMLDivElement;
  private _data: TData | null = null;
  private _renderScheduled = false;
  private _connected = false;

  /** Subclasses provide component-scoped CSS appended after the base sheet. */
  protected abstract componentCss(): string;
  /** Subclasses build their scene into `this.mount`. Called after data changes. */
  protected abstract render(): void;
  /**
   * Called when an interactive element (`[data-activate]`) is activated by
   * pointer or keyboard. `el` is the matched activation target.
   */
  protected abstract onActivate(el: Element, originalEvent: Event): void;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = TOKENS_CSS + BASE_CSS + this.componentCss();
    this.root.append(style);

    this.mount = html("div", { part: "scene", style: "position:relative;width:100%;height:100%;" });
    this.root.append(this.mount);

    // Event delegation: a single click + keydown listener for the whole scene.
    this.root.addEventListener("click", this.handleClick);
    this.root.addEventListener("keydown", this.handleKeydown);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback(): void {
    this._connected = true;
    if (this._data === null) this.readDataAttribute();
    this.scheduleRender();
  }

  disconnectedCallback(): void {
    this._connected = false;
  }

  static get observedAttributes(): string[] {
    return ["data"];
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "data" && value) this.readDataAttribute();
  }

  // ── Data ─────────────────────────────────────────────────────────────────--

  /** Declarative data for the component. Setting it schedules a re-render. */
  get data(): TData | null {
    return this._data;
  }

  set data(value: TData | null) {
    this._data = value;
    this.scheduleRender();
  }

  private readDataAttribute(): void {
    const raw = this.getAttribute("data");
    if (!raw) return;
    try {
      this._data = JSON.parse(raw) as TData;
      this.scheduleRender();
    } catch {
      // Fail closed: ignore malformed declarative data rather than throwing.
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  /** Schedule a render on the microtask queue (coalesces multiple sets). */
  protected scheduleRender(): void {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    queueMicrotask(() => {
      this._renderScheduled = false;
      if (this._connected) this.render();
    });
  }

  /** Force a synchronous re-render. Useful in tests. */
  public renderNow(): void {
    this.render();
  }

  /** Empty the scene mount. Subclasses call this at the top of render(). */
  protected resetScene(): void {
    clear(this.mount);
  }

  // ── Events ───────────────────────────────────────────────────────────────--

  /** Emit a bubbling, composed CustomEvent from the host element. */
  protected emit<T>(name: string, detail: T): boolean {
    return this.dispatchEvent(makeEvent(name, detail));
  }

  private handleClick = (event: Event): void => {
    const el = closestActivatable(event.composedPath?.()[0] ?? event.target);
    if (el) this.onActivate(el, event);
  };

  // Typed as Event because ShadowRoot.addEventListener only narrows
  // "slotchange"; we narrow to KeyboardEvent at runtime.
  private handleKeydown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    if (!isActivationKey(event.key)) return;
    const el = closestActivatable(event.composedPath?.()[0] ?? event.target);
    if (!el) return;
    // Prevent Space from scrolling and Enter from submitting an ancestor form.
    event.preventDefault();
    this.onActivate(el, event);
  };
}
