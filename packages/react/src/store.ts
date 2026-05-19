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

/** Build an `AgentStore`. Optionally seed with initial state. */
export function createAgentStore(initial: AgentState = createInitialAgentState()): AgentStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const actionListeners = new Set<ActionListener>();

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
      state = next;
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
