import { createContext, useContext, useCallback, type ReactNode } from "react";
import type { ActionEvent } from "@kibadist/agentui-protocol";

export type ActionSender = (action: ActionEvent) => Promise<void>;

const noop: ActionSender = async () => {
  console.warn("[agentui] ActionSender not provided – wrap your tree in <AgentActionProvider>.");
};

export const AgentActionContext = createContext<ActionSender>(noop);

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
