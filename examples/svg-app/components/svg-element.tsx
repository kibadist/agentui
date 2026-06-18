"use client";

import { createElement, useEffect, useRef, useState } from "react";

/**
 * Generic React host for an `@kibadist/agentui-svg` Web Component.
 *
 * The SVG component classes `extend HTMLElement`, which is UNDEFINED during
 * Next.js server-side rendering. So the custom-element registration must happen
 * CLIENT-SIDE ONLY — we dynamic-import the `/register` side-effect module from
 * inside an effect and never reference the package at server-evaluated module
 * top level. This is what keeps the production Next build from crashing with
 * "HTMLElement is not defined".
 */
let regP: Promise<unknown> | null = null;
function ensureRegistered() {
  if (typeof window === "undefined") return Promise.resolve();
  if (!regP) regP = import("@kibadist/agentui-svg/register");
  return regP;
}

export function SvgElement({
  tag,
  data,
  attrs,
  on,
  style,
}: {
  tag: string;
  data?: unknown;
  attrs?: Record<string, string>;
  on?: Record<string, (detail: unknown, e: Event) => void>;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let m = true;
    ensureRegistered().then(() => {
      if (m) setReady(true);
    });
    return () => {
      m = false;
    };
  }, []);

  useEffect(() => {
    if (ready && ref.current)
      (ref.current as unknown as { data: unknown }).data = data;
  }, [ready, data]);

  // Apply config as real HTML attributes (the components read them via
  // getAttribute / observedAttributes). We do NOT pass these through
  // createElement, because React 19 sets known *properties* on custom
  // elements — and e.g. `layout` is a getter-only accessor on the element,
  // so `el.layout = "..."` throws "Cannot set property … which has only a getter".
  const attrsKey = JSON.stringify(attrs ?? {});
  useEffect(() => {
    const el = ref.current;
    if (!el || !attrs) return;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, attrsKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const entries = Object.entries(on).map(([n, fn]) => {
      const h = (e: Event) => fn((e as CustomEvent).detail, e);
      el.addEventListener(n, h);
      return [n, h] as const;
    });
    return () => entries.forEach(([n, h]) => el.removeEventListener(n, h));
  }, [ready, on]);

  return createElement(tag, { ref, style });
}
