"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AgentError } from "./agent-error.js";
import {
  resolveAgentRoot,
  useAgentRootRegistryEntry,
} from "./agent-root-registry.js";

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
 * @param id Scope the lookup to the `<AgentRoot id="...">` with this id. Omit to resolve to the nearest agent.
 */
export function useAgentSession(id?: string): UseAgentSessionResult {
  const nearest = useContext(SessionContext);
  const entry = useAgentRootRegistryEntry();

  if (id !== undefined) {
    const resolved = resolveAgentRoot(entry, id);
    if (resolved === null) {
      throw new Error(`[agentui] No <AgentRoot id="${id}"> found in the tree.`);
    }
    return resolved.session;
  }

  if (nearest === null) {
    throw new Error(
      "[agentui] useAgentSession must be used inside <AgentRoot>. " +
        "Wrap your tree in <AgentRoot endpoint=\"...\">.",
    );
  }
  return nearest;
}

/**
 * Internal — `useAgentHistory` and similar hooks use this to access the
 * AgentRoot's endpoint and fetch. Throws if no `<AgentRoot>` ancestor.
 */
export function useAgentRootConfig(id?: string): AgentRootConfig {
  const nearest = useContext(AgentRootConfigContext);
  const entry = useAgentRootRegistryEntry();

  if (id !== undefined) {
    const resolved = resolveAgentRoot(entry, id);
    if (resolved === null) {
      throw new Error(`[agentui] No <AgentRoot id="${id}"> found in the tree.`);
    }
    return resolved.config;
  }

  if (nearest === null) {
    throw new Error(
      "[agentui] useAgentRootConfig must be used inside <AgentRoot>.",
    );
  }
  return nearest;
}
