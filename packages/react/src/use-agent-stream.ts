"use client";

import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from "react";
import type { UIEvent } from "@kibadist/agentui-protocol";
import { safeParseUIEvent } from "@kibadist/agentui-validate";
import { createAgentStore, type AgentStore } from "./store.js";
import type { AgentState } from "./reducer.js";

/**
 * The lifecycle state of the underlying `EventSource`: `idle` before the
 * effect runs, `connecting` during the handshake, `open` after, `closed`
 * when stopped, `error` on transport failure.
 */
export type StreamStatus = "idle" | "connecting" | "open" | "closed" | "error";

/** Options for {@link useAgentStream}. */
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

/** What {@link useAgentStream} returns: state, status, and control methods. */
export interface UseAgentStreamResult {
  state: AgentState;
  status: StreamStatus;
  /** Close the underlying EventSource (state is preserved). */
  close: () => void;
  /** Clear all UI state (nodes, toasts, navigate). Connection is unaffected. */
  reset: () => void;
  /**
   * Inject a UIEvent into the reducer without going through the wire.
   * Useful for optimistic updates, host-driven UI, and tests.
   */
  dispatch: (event: UIEvent) => void;
  /**
   * The subscribable store backing this stream. Wire into
   * `<AgentStateProvider store={...}>` to enable selector hooks below it.
   */
  store: AgentStore;
}

/**
 * Subscribe to an SSE-backed agent stream. Returns the reducer state, the
 * connection status, and methods to close, reset, or dispatch — plus the
 * underlying `store` for wiring `<AgentStateProvider>`.
 */
export function useAgentStream(options: UseAgentStreamOptions): UseAgentStreamResult {
  const { url, sessionId, onEvent, onInvalidEvent, enabled = true } = options;

  // Store is created once per hook instance and stays stable across renders.
  const storeRef = useRef<AgentStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createAgentStore();
  }
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
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
        store.send(parsed.value);
        onEventRef.current?.(parsed.value);
      } else {
        onInvalidRef.current?.(raw, parsed.error);
      }
    };

    es.onerror = () => {
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
    // `store` is stable for the life of this hook instance (created once in
    // storeRef above); it's in the dep array only to satisfy the exhaustive-deps
    // rule and will never actually cause this effect to re-run.
  }, [url, sessionId, enabled, store]);

  const close = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setStatus("closed");
  }, []);

  const reset = useCallback(() => {
    store.reset();
  }, [store]);

  const publicDispatch = useCallback(
    (event: UIEvent) => {
      store.send(event);
    },
    [store],
  );

  return { state, status, close, reset, dispatch: publicDispatch, store };
}
