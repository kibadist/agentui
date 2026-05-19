"use client";

import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from "react";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { safeParseAgentEvent } from "@kibadist/agentui-validate";
import { createAgentStore, type AgentStore } from "./store.js";
import type { CapsConfig } from "./store.js";
import type { AgentState } from "./reducer.js";
import { connectSse, SseHttpError } from "./sse-transport.js";
import { computeBackoff, type BackoffOptions } from "./stream-backoff.js";
import { createBuffer, type OverflowStrategy } from "./stream-buffer.js";
import type { MetricEmitter } from "./metrics.js";
import { hashSessionId } from "./metrics.js";

/**
 * Lifecycle state of the SSE connection.
 *
 * - `idle` — before the effect runs / disabled
 * - `connecting` — fetch in flight, no events received yet
 * - `open` — fetch succeeded, stream is delivering events
 * - `reauthenticating` — waiting for auth.getToken() / auth.onUnauthorized()
 * - `reconnecting` — sleeping the backoff delay between attempts
 * - `closed` — disposed (consumer called close() or effect unmounted)
 * - `error` — terminal: maxAttempts reached or fatal transport failure
 */
export type StreamStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reauthenticating"
  | "reconnecting"
  | "closed"
  | "error";

export interface RetryConfig extends Partial<BackoffOptions> {
  maxAttempts?: number;
  onGiveUp?: (err: Error) => void;
}

export interface BufferConfig {
  max: number;
  onOverflow: OverflowStrategy;
  onOverflowCallback?: (dropped: AgentWireEvent) => void;
}

export interface AuthConfig {
  getToken: () => Promise<string>;
  onUnauthorized?: () => Promise<void>;
}

/** Options for {@link useAgentStream}. */
export interface UseAgentStreamOptions {
  /** SSE endpoint URL */
  url: string;
  /** Session id (appended as query param) */
  sessionId: string;
  /** Called for every valid wire event after the reducer applies it. */
  onEvent?: (event: AgentWireEvent) => void;
  /** Called when an invalid event is received */
  onInvalidEvent?: (raw: unknown, error: Error) => void;
  /** Whether the stream is enabled (default true) */
  enabled?: boolean;
  /** Retry / backoff configuration */
  retry?: RetryConfig;
  /** Backpressure buffer configuration */
  buffer?: BufferConfig;
  /** Auth token provider and 401 handler */
  auth?: AuthConfig;
  /** Per-slice memory caps with drop-oldest eviction. */
  caps?: CapsConfig;
  /** Metric emitter to receive lifecycle and per-event timings. */
  metrics?: MetricEmitter;
}

/** What {@link useAgentStream} returns: state, status, and control methods. */
export interface UseAgentStreamResult {
  state: AgentState;
  status: StreamStatus;
  /** Close the underlying SSE connection (state is preserved). */
  close: () => void;
  /** Clear all UI state (nodes, toasts, navigate). Connection is unaffected. */
  reset: () => void;
  /**
   * Inject a wire event into the reducer without going through SSE.
   * Useful for client-side optimistic updates, host-driven UI, and tests.
   */
  dispatch: (event: AgentWireEvent) => void;
  /**
   * The subscribable store backing this stream. Wire into
   * `<AgentStateProvider store={...}>` to enable selector hooks below it.
   */
  store: AgentStore;
}

const DEFAULT_BACKOFF: BackoffOptions = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: "full",
};

function resolveBackoff(retry: RetryConfig | undefined): BackoffOptions {
  return {
    initialDelayMs: retry?.initialDelayMs ?? DEFAULT_BACKOFF.initialDelayMs,
    maxDelayMs: retry?.maxDelayMs ?? DEFAULT_BACKOFF.maxDelayMs,
    jitter: retry?.jitter ?? DEFAULT_BACKOFF.jitter,
  };
}

/**
 * Subscribe to an SSE-backed agent stream with retry/backoff, backpressure
 * buffering, and auth-aware reconnect. Returns the reducer state, the
 * connection status, and methods to close, reset, or dispatch — plus the
 * underlying `store` for wiring `<AgentStateProvider>`.
 */
export function useAgentStream(options: UseAgentStreamOptions): UseAgentStreamResult {
  const { url, sessionId, onEvent, onInvalidEvent, enabled = true, retry, buffer, auth, caps, metrics } = options;

  // Store is created once per hook instance and stays stable across renders.
  const storeRef = useRef<AgentStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createAgentStore({
      caps,
      onPatchFailure: (event, error) =>
        onInvalidRef.current?.(event, new Error(`patch apply failed: ${error}`)),
    });
  }
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [status, setStatus] = useState<StreamStatus>("idle");

  // Stable refs for callbacks — updated every render but never trigger effects.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onInvalidRef = useRef(onInvalidEvent);
  onInvalidRef.current = onInvalidEvent;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;
  const authRef = useRef(auth);
  authRef.current = auth;

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    let attempt = 0;
    let lastEventId: string | undefined;
    let cancelled = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const backoffOpts = resolveBackoff(retryRef.current);
    const maxAttempts = retryRef.current?.maxAttempts ?? Infinity;

    const sep = url.includes("?") ? "&" : "?";
    const sseUrl = `${url}${sep}sessionId=${encodeURIComponent(sessionId)}`;

    const evtBuffer = bufferRef.current
      ? createBuffer<AgentWireEvent>({
          max: bufferRef.current.max,
          onOverflow: bufferRef.current.onOverflow,
          onOverflowCallback: bufferRef.current.onOverflowCallback,
        })
      : null;

    function drainBuffer() {
      evtBuffer?.drain((event) => {
        store.send(event);
        onEventRef.current?.(event);
      });
    }

    function ingest(event: AgentWireEvent) {
      if (evtBuffer) {
        evtBuffer.enqueue(event);
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(drainBuffer);
        } else {
          setTimeout(drainBuffer, 0);
        }
      } else {
        store.send(event);
        onEventRef.current?.(event);
      }
    }

    /** Returns true when the loop should exit (cancelled or gave up). */
    async function advanceOrGiveUp(err: Error): Promise<boolean> {
      attempt++;
      metricsRef.current?.counter("agentui.stream.reconnect_attempts");
      if (attempt >= maxAttempts) {
        retryRef.current?.onGiveUp?.(err);
        setStatus("error");
        return true;
      }
      setStatus("reconnecting");
      const delay = computeBackoff(attempt - 1, backoffOpts);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay);
        ctrl.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
      return cancelled;
    }

    async function attemptConnect(): Promise<void> {
      while (!cancelled && attempt < maxAttempts) {
        const a = authRef.current;
        let headers: Record<string, string> | undefined;
        if (a) {
          setStatus("reauthenticating");
          try {
            const token = await a.getToken();
            headers = { Authorization: `Bearer ${token}` };
          } catch (err) {
            if (await advanceOrGiveUp(err as Error)) return;
            continue;
          }
        }

        setStatus("connecting");
        let connectionError: Error | null = null;
        let unauthorized = false;

        const connectStartMs = performance.now();
        let firstEventEmitted = false;

        await connectSse({
          url: sseUrl,
          headers,
          lastEventId,
          signal: ctrl.signal,
          onOpen: () => {
            attempt = 0;
            setStatus("open");
            metricsRef.current?.timing(
              "agentui.stream.connect_ms",
              performance.now() - connectStartMs,
              { sessionId: hashSessionId(sessionId) },
            );
          },
          onEvent: (raw, id) => {
            if (id !== undefined) lastEventId = id;
            let parsedRaw: unknown;
            try {
              parsedRaw = JSON.parse(raw);
            } catch {
              return;
            }

            const parseStart = performance.now();
            const result = safeParseAgentEvent(parsedRaw);
            metricsRef.current?.timing(
              "agentui.event.parse_ms",
              performance.now() - parseStart,
              { eventOp: (parsedRaw as { op?: string }).op ?? "unknown" },
            );

            if (result.ok) {
              if (!firstEventEmitted) {
                firstEventEmitted = true;
                metricsRef.current?.timing(
                  "agentui.stream.first_event_ms",
                  performance.now() - connectStartMs,
                  { sessionId: hashSessionId(sessionId) },
                );
              }
              const dispatchStart = performance.now();
              ingest(result.value);
              metricsRef.current?.timing(
                "agentui.event.dispatch_ms",
                performance.now() - dispatchStart,
                { eventOp: result.value.op },
              );
            } else {
              metricsRef.current?.counter("agentui.event.parse_error_count");
              onInvalidRef.current?.(parsedRaw, result.error);
            }
          },
          onError: (err) => {
            connectionError = err;
            if (err instanceof SseHttpError && err.status === 401) {
              unauthorized = true;
            }
          },
        });

        if (cancelled) return;

        if (unauthorized && authRef.current?.onUnauthorized) {
          try {
            await authRef.current.onUnauthorized();
          } catch (err) {
            if (await advanceOrGiveUp(err as Error)) return;
            continue;
          }
          // After onUnauthorized resolves, retry from the top (getToken again).
          continue;
        }

        if (connectionError === null) {
          // Clean close — server ended the stream normally.
          setStatus("closed");
          return;
        }

        if (await advanceOrGiveUp(connectionError)) return;
      }
    }

    attemptConnect();

    return () => {
      cancelled = true;
      ctrl.abort();
      abortRef.current = null;
      setStatus("closed");
    };
    // `store` is stable for the life of this hook instance (created once in
    // storeRef above); it's in the dep array only to satisfy the exhaustive-deps
    // rule and will never actually cause this effect to re-run.
  }, [url, sessionId, enabled, store]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("closed");
  }, []);

  const reset = useCallback(() => {
    store.reset();
  }, [store]);

  const publicDispatch = useCallback(
    (event: AgentWireEvent) => {
      store.send(event);
    },
    [store],
  );

  return { state, status, close, reset, dispatch: publicDispatch, store };
}
