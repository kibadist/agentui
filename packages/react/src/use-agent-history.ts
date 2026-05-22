"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryMessage } from "@kibadist/agentui-protocol";
import { useAgentRootConfig, useAgentSession } from "./session-context.js";
import type { AgentError } from "./agent-error.js";

export type { HistoryMessage } from "@kibadist/agentui-protocol";

export interface UseAgentHistoryResult {
  messages: HistoryMessage[];
  loading: boolean;
  error: AgentError | null;
  reload: () => Promise<void>;
}

/**
 * Subscribe to the conversation history for the current session.
 * Calls `transport.getHistory({ sessionId })` once on session start.
 * Use `reload()` to refetch on demand.
 *
 * @param id Scope the lookup to the `<AgentRoot id="...">` with this id. Omit to resolve to the nearest agent.
 */
export function useAgentHistory(id?: string): UseAgentHistoryResult {
  const { sessionId } = useAgentSession(id);
  const config = useAgentRootConfig(id);
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AgentError | null>(null);
  const seqRef = useRef(0);

  const fetchHistory = useCallback(
    async (sid: string): Promise<void> => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await config.transport.getHistory({ sessionId: sid });
        if (seq !== seqRef.current) return;
        setMessages(result.messages);
        setLoading(false);
      } catch (cause) {
        if (seq !== seqRef.current) return;
        setMessages([]);
        setLoading(false);
        setError({
          kind: "history-fetch",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
      }
    },
    [config],
  );

  useEffect(() => {
    if (sessionId !== null && sessionId !== "") {
      void fetchHistory(sessionId);
    } else {
      setMessages([]);
      setError(null);
      setLoading(false);
    }
  }, [sessionId, fetchHistory]);

  const reload = useCallback(async () => {
    if (sessionId !== null && sessionId !== "") {
      await fetchHistory(sessionId);
    }
  }, [sessionId, fetchHistory]);

  return { messages, loading, error, reload };
}
