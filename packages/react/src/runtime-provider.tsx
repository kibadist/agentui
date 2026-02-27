import { useCallback, type ReactNode } from "react";
import type { ActionEvent } from "@kibadist/agentui-protocol";
import { AgentActionProvider } from "./action-context.js";
import { useAgentStream, type StreamStatus } from "./use-agent-stream.js";
import type { AgentState } from "./reducer.js";

export interface AgentRuntimeProviderProps {
  /** SSE stream URL */
  url: string;
  /** Session id */
  sessionId: string;
  /** POST endpoint for actions (defaults to url with /action suffix) */
  actionUrl?: string;
  /** Render prop receiving state + status */
  children: (ctx: {
    state: AgentState;
    status: StreamStatus;
    close: () => void;
  }) => ReactNode;
}

export function AgentRuntimeProvider({
  url,
  sessionId,
  actionUrl,
  children,
}: AgentRuntimeProviderProps) {
  const { state, status, close } = useAgentStream({ url, sessionId });

  const resolvedActionUrl = actionUrl ?? url.replace(/\/stream\/?$/, "/action");

  const sender = useCallback(
    async (action: ActionEvent) => {
      await fetch(resolvedActionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
    },
    [resolvedActionUrl],
  );

  return (
    <AgentActionProvider sender={sender}>
      {children({ state, status, close })}
    </AgentActionProvider>
  );
}
