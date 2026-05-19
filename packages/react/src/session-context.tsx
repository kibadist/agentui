"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AgentError } from "./agent-error.js";

export interface UseAgentSessionResult {
  sessionId: string | null;
  conversationId: string | null;
  status: "idle" | "connecting" | "connected" | "error";
  error: AgentError | null;
  create: () => Promise<void>;
  resume: (conversationId: string) => Promise<void>;
  reset: () => Promise<void>;
  close: () => void;
}

/**
 * Connection config — endpoint + fetch — published by `<AgentRoot>` so hooks
 * like `useAgentHistory` can issue requests without needing those as props.
 */
export interface AgentRootConfig {
  endpoint: string;
  fetch: typeof fetch;
}

const SessionContext = createContext<UseAgentSessionResult | null>(null);
const AgentRootConfigContext = createContext<AgentRootConfig | null>(null);

/**
 * Internal provider used by `<AgentRoot>`. Hosts should not use this directly —
 * mount `<AgentRoot>` instead.
 */
export interface SessionProviderProps {
  value: UseAgentSessionResult;
  config: AgentRootConfig;
  children: ReactNode;
}

export function SessionProvider({ value, config, children }: SessionProviderProps) {
  return (
    <AgentRootConfigContext.Provider value={config}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </AgentRootConfigContext.Provider>
  );
}

/**
 * Subscribe to the current session lifecycle state. Must be used inside an
 * `<AgentRoot>` ancestor.
 *
 * @param id Reserved for multi-agent support (DET-143). Ignored in v0.5.4.
 */
export function useAgentSession(_id?: string): UseAgentSessionResult {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error(
      "[agentui] useAgentSession must be used inside <AgentRoot>. " +
        "Wrap your tree in <AgentRoot endpoint=\"...\">.",
    );
  }
  return value;
}

/**
 * Internal — `useAgentHistory` and similar hooks use this to access the
 * AgentRoot's endpoint and fetch. Throws if no `<AgentRoot>` ancestor.
 */
export function useAgentRootConfig(): AgentRootConfig {
  const value = useContext(AgentRootConfigContext);
  if (value === null) {
    throw new Error(
      "[agentui] useAgentRootConfig must be used inside <AgentRoot>.",
    );
  }
  return value;
}
