import { useEffect, useRef, useReducer, useCallback, useState } from "react";
import type { UIEvent } from "@kibadist/agentui-protocol";
import { safeParseUIEvent } from "@kibadist/agentui-validate";
import { agentReducer, initialAgentState, type AgentState } from "./reducer.js";

export type StreamStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface UseAgentStreamOptions {
  /** SSE endpoint URL */
  url: string;
  /** Session id (appended as query param) */
  sessionId: string;
  /** Called for every valid UIEvent (after reducer) */
  onEvent?: (event: UIEvent) => void;
  /** Called when an invalid event is received */
  onInvalidEvent?: (raw: unknown, error: Error) => void;
  /** Whether the stream is enabled (default true) */
  enabled?: boolean;
}

export function useAgentStream(options: UseAgentStreamOptions) {
  const { url, sessionId, onEvent, onInvalidEvent, enabled = true } = options;
  const [state, dispatch] = useReducer(agentReducer, initialAgentState);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const esRef = useRef<EventSource | null>(null);

  // Stable refs for callbacks
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onInvalidRef = useRef(onInvalidEvent);
  onInvalidRef.current = onInvalidEvent;

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    const separator = url.includes("?") ? "&" : "?";
    const sseUrl = `${url}${separator}sessionId=${encodeURIComponent(sessionId)}`;

    setStatus("connecting");
    const es = new EventSource(sseUrl);
    esRef.current = es;

    es.onopen = () => setStatus("open");

    es.onmessage = (msg) => {
      let raw: unknown;
      try {
        raw = JSON.parse(msg.data);
      } catch {
        return; // ignore non-JSON heartbeats etc.
      }

      const parsed = safeParseUIEvent(raw);
      if (parsed.ok) {
        dispatch(parsed.value);
        onEventRef.current?.(parsed.value);
      } else {
        onInvalidRef.current?.(raw, parsed.error);
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; surface status
      if (es.readyState === EventSource.CLOSED) {
        setStatus("closed");
      } else {
        setStatus("error");
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setStatus("closed");
    };
  }, [url, sessionId, enabled]);

  const close = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setStatus("closed");
  }, []);

  return { state, status, close };
}
