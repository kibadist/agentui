"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AgentStore } from "./store.js";

const AgentStoreContext = createContext<AgentStore | null>(null);

export interface AgentStateProviderProps {
  store: AgentStore;
  children: ReactNode;
}

export function AgentStateProvider({ store, children }: AgentStateProviderProps) {
  return (
    <AgentStoreContext.Provider value={store}>{children}</AgentStoreContext.Provider>
  );
}

/**
 * Internal: read the current AgentStore from context. Throws if no provider
 * is mounted — selector hooks fail loudly when wired up wrong.
 */
export function useAgentStore(): AgentStore {
  const store = useContext(AgentStoreContext);
  if (store === null) {
    throw new Error(
      "[agentui] useAgentNodes / useAgentSelector must be used inside <AgentStateProvider>. " +
        "Wire it up with: const { store } = useAgentStream(...); then wrap children in <AgentStateProvider store={store}>.",
    );
  }
  return store;
}
