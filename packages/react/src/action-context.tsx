"use client";

import { createContext, useContext, useCallback, type ReactNode } from "react";
import type { ActionEvent } from "@kibadist/agentui-protocol";

/** Function the action context dispatches user actions through (typically a POST to the backend). */
export type ActionSender = (action: ActionEvent) => Promise<void>;

const noop: ActionSender = async () => {
  console.warn("[agentui] ActionSender not provided – wrap your tree in <AgentActionProvider>.");
};

/**
 * React context holding the current {@link ActionSender}. Most consumers
 * should use {@link useAgentAction} rather than reading this directly.
 */
export const AgentActionContext = createContext<ActionSender>(noop);

/**
 * Puts an {@link ActionSender} on context so descendants can call
 * {@link useAgentAction} to dispatch user actions back to the agent.
 */
export function AgentActionProvider({
  sender,
  children,
}: {
  sender: ActionSender;
  children: ReactNode;
}) {
  return <AgentActionContext.Provider value={sender}>{children}</AgentActionContext.Provider>;
}

/**
 * Hook to dispatch an action back to the agent.
 * Components should use this instead of calling fetch directly.
 */
export function useAgentAction(): ActionSender {
  return useContext(AgentActionContext);
}
