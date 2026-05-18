import { agentReducer, createInitialAgentState, type AgentAction, type AgentState } from "./reducer.js";

export interface AgentStore {
  getState(): AgentState;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Dispatch an action through `agentReducer` and notify listeners if state changed. */
  send(action: AgentAction): void;
  /** Shorthand for `send({ op: "__reset__" })`. */
  reset(): void;
}

export function createAgentStore(initial: AgentState = createInitialAgentState()): AgentStore {
  let state = initial;
  const listeners = new Set<() => void>();

  const store: AgentStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send(action) {
      const next = agentReducer(state, action);
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
    reset() {
      store.send({ op: "__reset__" });
    },
  };

  return store;
}
