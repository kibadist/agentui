"use client";

import { useSyncExternalStore } from "react";
import { createAgentStore, type AgentStore } from "../store.js";
import { createInitialAgentState, type AgentAction, type AgentState } from "../reducer.js";
import type { UIEvent, AgentWireEvent } from "@kibadist/agentui-protocol";
import type { StreamStatus, UseAgentStreamResult } from "../use-agent-stream.js";

export interface MockAgentStream {
  /** Drop-in for `useAgentStream`. Call inside a React render context. */
  hook: () => UseAgentStreamResult;
  /** The underlying AgentStore. Wire into `<AgentStateProvider store={...}>`. */
  store: AgentStore;
  /** Simulate inbound SSE (typed to UIEvent — wire-level events only). */
  push: (event: UIEvent) => void;
  /** Reducer-level injection. Accepts any `AgentAction` (UIEvent, ToolEvent, ReasoningEvent, OptimisticEvent, or AgentResetAction). */
  dispatchInternal: (action: AgentAction) => void;
  /** Drive the StreamStatus subscribers. */
  setStatus: (status: StreamStatus) => void;
  /** Shorthand for `store.reset()`. */
  reset: () => void;
  /** Live snapshot — readable in assertions (getter; always current). */
  readonly state: AgentState;
  /** Recorded actions in dispatch order. Mutated in place. */
  history: AgentAction[];
}

export function createMockAgentStream(initial?: Partial<AgentState>): MockAgentStream {
  const store = createAgentStore({ ...createInitialAgentState(), ...initial });
  const history: AgentAction[] = [];
  let currentStatus: StreamStatus = "idle";
  const statusListeners = new Set<() => void>();

  // Wrap send to record dispatch history. push() and dispatchInternal() both
  // route through store.send, and store.reset() internally sends "__reset__",
  // so this captures every action consistently.
  const originalSend = store.send;
  store.send = (action: AgentAction) => {
    history.push(action);
    originalSend(action);
  };

  const hook = (): UseAgentStreamResult => {
    const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
    const status = useSyncExternalStore(
      (l) => {
        statusListeners.add(l);
        return () => {
          statusListeners.delete(l);
        };
      },
      () => currentStatus,
      () => currentStatus,
    );
    return {
      state,
      status,
      store,
      close: () => {
        currentStatus = "closed";
        statusListeners.forEach((l) => l());
      },
      reset: () => store.reset(),
      dispatch: (event: AgentWireEvent) => store.send(event),
    };
  };

  return {
    hook,
    store,
    push: (event: UIEvent) => store.send(event),
    dispatchInternal: (action: AgentAction) => store.send(action),
    setStatus: (status: StreamStatus) => {
      currentStatus = status;
      statusListeners.forEach((l) => l());
    },
    reset: () => store.reset(),
    get state() {
      return store.getState();
    },
    history,
  };
}
