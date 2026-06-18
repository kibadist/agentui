// ─── Custom element registration helper ──────────────────────────────────────
//
// Guards against double registration (which throws in the browser) so that
// importing `@kibadist/agentui-svg/register` more than once is safe.

export function defineElement(
  tagName: string,
  ctor: CustomElementConstructor,
): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get(tagName)) return;
  customElements.define(tagName, ctor);
}
