"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState, ToolCall, ReasoningSegment } from "./reducer.js";

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

/** Subscribe to all tool calls in insertion order. Re-renders only when the tool-call slice changes. */
export function useToolCalls(): ToolCall[] {
  return useAgentSelector(
    (s) => {
      const arr: ToolCall[] = [];
      for (const id of s.toolCallsOrder) {
        const c = s.toolCalls.get(id);
        if (c) arr.push(c);
      }
      return arr;
    },
    // Shallow array equality: same length + same references in same order.
    // Keeps consumers stable when unrelated state changes (e.g. ui.toast)
    // create a new outer state object but leave the toolCalls Map intact.
    (a, b) => a.length === b.length && a.every((c, i) => c === b[i]),
  );
}

/** Subscribe to a single tool call by id. Re-renders only when that specific call's fields change. */
export function useToolCall(id: string): ToolCall | undefined {
  return useAgentSelector((s) => s.toolCalls.get(id));
}

/** Subscribe to all reasoning segments in insertion order. Re-renders only when the reasoning slice changes. */
export function useReasoning(): ReasoningSegment[] {
  return useAgentSelector(
    (s) => {
      const arr: ReasoningSegment[] = [];
      for (const id of s.reasoningOrder) {
        const seg = s.reasoning.get(id);
        if (seg) arr.push(seg);
      }
      return arr;
    },
    (a, b) => a.length === b.length && a.every((seg, i) => seg === b[i]),
  );
}

/**
 * Subscribe to the most recently started reasoning segment (streaming or done).
 * During a streaming segment, returns the in-progress one; after `reasoning.end`
 * it still returns that segment until a new `reasoning.start` flips the latest.
 */
export function useLatestReasoning(): ReasoningSegment | undefined {
  return useAgentSelector((s) => {
    const order = s.reasoningOrder;
    if (order.length === 0) return undefined;
    return s.reasoning.get(order[order.length - 1]);
  });
}
