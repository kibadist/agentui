"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentRootConfig, useAgentSession } from "./session-context.js";
import type { AgentError } from "./agent-error.js";

export interface HistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ts: string;
}

export interface UseAgentHistoryResult {
  messages: HistoryMessage[];
  loading: boolean;
  error: AgentError | null;
  reload: () => Promise<void>;
}

/**
 * Subscribe to the conversation history for the current session.
 * Fetches `GET {endpoint}/history?sessionId={sessionId}` once on session start.
 * Use `reload()` to refetch on demand.
 *
 * @param id Reserved for multi-agent support (DET-143). Ignored in v0.5.4.
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
        const url = `${config.endpoint}/history?sessionId=${encodeURIComponent(sid)}`;
        const res = await config.fetch(url, { method: "GET" });
        if (res.status === 404) {
          if (seq !== seqRef.current) return;
          setMessages([]);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          if (seq !== seqRef.current) return;
          setMessages([]);
          setLoading(false);
          setError({
            kind: "history-fetch",
            message: `History fetch failed: ${res.status} ${res.statusText}`,
            cause: res,
          });
          return;
        }
        const data = (await res.json()) as { messages: HistoryMessage[] };
        if (seq !== seqRef.current) return;
        setMessages(data.messages ?? []);
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
