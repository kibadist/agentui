import { agentReducer, createInitialAgentState, type AgentAction, type AgentState } from "./reducer.js";

/**
 * Listener invoked by `AgentStore.subscribeAction` after every non-no-op
 * dispatch. Receives the action that just ran, the resulting state, and the
 * wall-clock ms taken by the listener-notify loop (state subscribers + action
 * subscribers, measured together).
 */
export type ActionListener = (
  action: AgentAction,
  nextState: AgentState,
  dispatchMs: number,
) => void;

/** Names of the slices that can be evicted by memory caps. */
export type EvictableSlice = "nodes" | "toasts" | "toolCalls" | "reasoning";

/**
 * Per-slice upper bounds for the `AgentStore`. When a slice exceeds its cap
 * the store drops the oldest items immediately after each dispatch.
 *
 * - Caps are applied **after** the reducer runs, so the reducer's own
 *   `MAX_TOASTS = 50` default stays in effect when `maxToasts` is not set.
 * - Set a cap to `Infinity` (or leave it unset) to disable eviction for that
 *   slice.
 * - `onEvict` is called once per slice per dispatch where items are dropped.
 */
export interface CapsConfig {
  maxNodes?: number;
  maxToasts?: number;
  maxToolCalls?: number;
  maxReasoning?: number;
  onEvict?: (slice: EvictableSlice, evicted: unknown[]) => void;
}

/** Options accepted by {@link createAgentStore}. */
export interface CreateAgentStoreOptions {
  /** Seed the store with a pre-built state (e.g. for testing). */
  initial?: AgentState;
  caps?: CapsConfig;
}

/**
 * A subscribable wrapper around `AgentState` driven by `agentReducer`.
 * Wire into `<AgentStateProvider>` to power selector hooks
 * (`useAgentNodes`, `useAgentSelector`, etc.).
 */
export interface AgentStore {
  getState(): AgentState;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /**
   * Subscribe to every non-no-op action with the resulting state and dispatch
   * latency. Used by `@kibadist/agentui-react/devtools` and any host that
   * wants to log every wire event (e.g., to Sentry).
   */
  subscribeAction(listener: ActionListener): () => void;
  /** Dispatch an action through `agentReducer` and notify listeners if state changed. */
  send(action: AgentAction): void;
  /** Shorthand for `send({ op: "__reset__" })`. */
  reset(): void;
}

/** Build an `AgentStore`. Accepts optional memory-cap configuration. */
export function createAgentStore(options?: CreateAgentStoreOptions): AgentStore {
  const caps = options?.caps;
  let state = options?.initial ?? createInitialAgentState();
  const listeners = new Set<() => void>();
  const actionListeners = new Set<ActionListener>();

  function applyEviction(prev: AgentState): AgentState {
    if (!caps) return prev;
    let s = prev;
    const onEvict = caps.onEvict;

    // ── nodes ──────────────────────────────────────────────────────────────
    const maxNodes = caps.maxNodes ?? Infinity;
    if (s.nodes.length > maxNodes) {
      const evictCount = s.nodes.length - maxNodes;
      const evicted = s.nodes.slice(0, evictCount);
      const nodes = s.nodes.slice(evictCount);
      const byKey = new Map<string, number>();
      for (let i = 0; i < nodes.length; i++) byKey.set(nodes[i].key, i);
      s = { ...s, nodes, byKey };
      onEvict?.("nodes", evicted);
    }

    // ── toasts ─────────────────────────────────────────────────────────────
    // Only override the reducer's built-in MAX_TOASTS when caps.maxToasts is
    // explicitly set. This lets hosts apply a tighter cap without touching the
    // reducer.
    if (caps.maxToasts !== undefined && s.toasts.length > caps.maxToasts) {
      const evictCount = s.toasts.length - caps.maxToasts;
      const evicted = s.toasts.slice(0, evictCount);
      s = { ...s, toasts: s.toasts.slice(-caps.maxToasts) };
      onEvict?.("toasts", evicted);
    }

    // ── toolCalls ──────────────────────────────────────────────────────────
    const maxToolCalls = caps.maxToolCalls ?? Infinity;
    if (s.toolCallsOrder.length > maxToolCalls) {
      const evictCount = s.toolCallsOrder.length - maxToolCalls;
      const evictedIds = s.toolCallsOrder.slice(0, evictCount);
      const newOrder = s.toolCallsOrder.slice(evictCount);
      const newMap = new Map(s.toolCalls);
      const evictedItems: unknown[] = [];
      for (const id of evictedIds) {
        const item = newMap.get(id);
        if (item !== undefined) evictedItems.push(item);
        newMap.delete(id);
      }
      s = { ...s, toolCalls: newMap, toolCallsOrder: newOrder };
      onEvict?.("toolCalls", evictedItems);
    }

    // ── reasoning ──────────────────────────────────────────────────────────
    const maxReasoning = caps.maxReasoning ?? Infinity;
    if (s.reasoningOrder.length > maxReasoning) {
      const evictCount = s.reasoningOrder.length - maxReasoning;
      const evictedIds = s.reasoningOrder.slice(0, evictCount);
      const newOrder = s.reasoningOrder.slice(evictCount);
      const newMap = new Map(s.reasoning);
      const evictedItems: unknown[] = [];
      for (const id of evictedIds) {
        const item = newMap.get(id);
        if (item !== undefined) evictedItems.push(item);
        newMap.delete(id);
      }
      s = { ...s, reasoning: newMap, reasoningOrder: newOrder };
      onEvict?.("reasoning", evictedItems);
    }

    return s;
  }

  const store: AgentStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeAction(listener) {
      actionListeners.add(listener);
      return () => {
        actionListeners.delete(listener);
      };
    },
    send(action) {
      const start = performance.now();
      const next = agentReducer(state, action);
      if (next === state) return; // no-op: skip both state and action listeners
      state = applyEviction(next);
      listeners.forEach((l) => l());
      if (actionListeners.size > 0) {
        const dispatchMs = performance.now() - start;
        actionListeners.forEach((l) => l(action, state, dispatchMs));
      }
    },
    reset() {
      store.send({ op: "__reset__" });
    },
  };

  return store;
}
