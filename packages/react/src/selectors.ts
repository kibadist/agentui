"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState, ToolCall, ReasoningSegment, OptimisticEntry } from "./reducer.js";
import type { AgentStore } from "./store.js";
import {
  resolveAgentRoot,
  useAgentRootRegistryEntry,
} from "./agent-root-registry.js";

const UNSET: unique symbol = Symbol("agentui:unset");

function useResolvedStore(id: string | undefined): AgentStore {
  const fromContext = useAgentStore(); // throws if no provider
  const entry = useAgentRootRegistryEntry();
  if (id === undefined) return fromContext;
  const resolved = resolveAgentRoot(entry, id);
  if (resolved === null) {
    throw new Error(`[agentui] No <AgentRoot id="${id}"> found in the tree.`);
  }
  return resolved.store;
}

/**
 * Subscribe to a derived slice of `AgentState`. The selector is re-run on every
 * store notification; the consumer re-renders only when `eq(prev, next)` is
 * false. Default `eq` is `Object.is`.
 */
export function useAgentSelector<T>(
  selector: (state: AgentState) => T,
  eq: (a: T, b: T) => boolean = Object.is,
  id?: string,
): T {
  const store = useResolvedStore(id);
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
export const useAgentNodes = (id?: string) =>
  useAgentSelector((s) => s.nodes, undefined, id);

/** Subscribe to `state.toasts`. Re-renders only when the toasts array reference changes. */
export const useAgentToasts = (id?: string) =>
  useAgentSelector((s) => s.toasts, undefined, id);

/** Subscribe to the latest pending navigation intent (or null). Re-renders only when that slice changes. */
export const useAgentNavigate = (id?: string) =>
  useAgentSelector((s) => s.navigate, undefined, id);

/** Subscribe to all tool calls in insertion order. Re-renders only when the tool-call slice changes. */
export function useToolCalls(id?: string): ToolCall[] {
  return useAgentSelector(
    (s) => {
      const arr: ToolCall[] = [];
      for (const callId of s.toolCallsOrder) {
        const c = s.toolCalls.get(callId);
        if (c) arr.push(c);
      }
      return arr;
    },
    // Shallow array equality: same length + same references in same order.
    // Keeps consumers stable when unrelated state changes (e.g. ui.toast)
    // create a new outer state object but leave the toolCalls Map intact.
    (a, b) => a.length === b.length && a.every((c, i) => c === b[i]),
    id,
  );
}

/** Subscribe to a single tool call by id. Re-renders only when that specific call's fields change. */
export function useToolCall(callId: string, id?: string): ToolCall | undefined {
  return useAgentSelector((s) => s.toolCalls.get(callId), undefined, id);
}

/** Subscribe to all reasoning segments in insertion order. Re-renders only when the reasoning slice changes. */
export function useReasoning(id?: string): ReasoningSegment[] {
  return useAgentSelector(
    (s) => {
      const arr: ReasoningSegment[] = [];
      for (const segId of s.reasoningOrder) {
        const seg = s.reasoning.get(segId);
        if (seg) arr.push(seg);
      }
      return arr;
    },
    (a, b) => a.length === b.length && a.every((seg, i) => seg === b[i]),
    id,
  );
}

/**
 * Subscribe to the most recently started reasoning segment (streaming or done).
 * During a streaming segment, returns the in-progress one; after `reasoning.end`
 * it still returns that segment until a new `reasoning.start` flips the latest.
 */
export function useLatestReasoning(id?: string): ReasoningSegment | undefined {
  return useAgentSelector(
    (s) => {
      const order = s.reasoningOrder;
      if (order.length === 0) return undefined;
      return s.reasoning.get(order[order.length - 1]);
    },
    undefined,
    id,
  );
}

/** Subscribe to the optimistic patch for a single entity. Returns undefined when no entry. */
export function useOptimistic(entityKey: string, id?: string): Record<string, unknown> | undefined {
  return useAgentSelector((s) => s.optimistic.get(entityKey)?.patch, undefined, id);
}

/** Subscribe to the entire optimistic Map. Re-renders on any optimistic change. */
export function useOptimisticAll(id?: string): Map<string, OptimisticEntry> {
  return useAgentSelector((s) => s.optimistic, undefined, id);
}
