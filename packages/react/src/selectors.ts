"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState } from "./reducer.js";

const UNSET: unique symbol = Symbol("agentui:unset");

/**
 * Subscribe to a derived slice of `AgentState`. The selector is re-run on every
 * store notification; the consumer re-renders only when `eq(prev, next)` is
 * false. Default `eq` is `Object.is`.
 */
export function useAgentSelector<T>(
  selector: (state: AgentState) => T,
  eq: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useAgentStore();
  const selRef = useRef(selector);
  selRef.current = selector;
  const eqRef = useRef(eq);
  eqRef.current = eq;
  const lastRef = useRef<T | typeof UNSET>(UNSET);

  const getSnapshot = useCallback(() => {
    const next = selRef.current(store.getState());
    if (lastRef.current !== UNSET && eqRef.current(lastRef.current as T, next)) {
      return lastRef.current as T;
    }
    lastRef.current = next;
    return next;
  }, [store]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Subscribe to `state.nodes`. Re-renders only when the nodes array reference changes. */
export const useAgentNodes = () => useAgentSelector((s) => s.nodes);
/** Subscribe to `state.toasts`. Re-renders only when the toasts array reference changes. */
export const useAgentToasts = () => useAgentSelector((s) => s.toasts);
/** Subscribe to the latest pending navigation intent (or null). Re-renders only when that slice changes. */
export const useAgentNavigate = () => useAgentSelector((s) => s.navigate);
