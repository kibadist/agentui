"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentWireEvent,
  Transport,
} from "@kibadist/agentui-protocol";
import { SessionNotFoundError } from "@kibadist/agentui-protocol";
import { AgentActionProvider, type ActionSender } from "./action-context.js";
import { AgentStateProvider } from "./agent-state-context.js";
import {
  AgentRootRegistry,
  type AgentRootRegistryEntry,
} from "./agent-root-registry.js";
import { SessionProvider, type UseAgentSessionResult } from "./session-context.js";
import { useAgentStream } from "./use-agent-stream.js";
import { httpTransport } from "./http-transport.js";
import { localStorageAdapter, type SessionStorageAdapter } from "./storage-adapter.js";
import type { AgentError } from "./agent-error.js";
import type { CapsConfig } from "./store.js";
import type { Metric } from "./metrics.js";
import { createMetricEmitter, hashSessionId } from "./metrics.js";

export interface AgentRootProps {
  /**
   * Transport driving session creation, the event stream, action dispatch,
   * and history fetches. If omitted, a default {@link httpTransport} is
   * constructed from {@link AgentRootProps.endpoint} (and optionally
   * {@link AgentRootProps.fetch}).
   *
   * Pass a custom transport when you want to route through your own API
   * client, run AgentUI in-process, or swap the wire (WebSocket etc.) —
   * anything implementing the `Transport` interface works.
   */
  transport?: Transport;
  /**
   * Base endpoint for the default HTTP transport (`POST /session`,
   * `GET /stream`, `POST /action`, `GET /history` are appended). Ignored
   * when {@link AgentRootProps.transport} is supplied.
   *
   * @deprecated Pass `transport={httpTransport({ endpoint, fetch })}` instead.
   * Removed in v2.0.
   */
  endpoint?: string;
  /**
   * Custom fetch wrapper for the default HTTP transport. Ignored when
   * {@link AgentRootProps.transport} is supplied.
   *
   * @deprecated Configure fetch on the transport you pass in.
   * Removed in v2.0.
   */
  fetch?: typeof fetch;
  storage?: SessionStorageAdapter;
  autoConnect?: boolean;
  onError?: (err: AgentError) => void;
  /**
   * Receives every wire event that fails `safeParseAgentEvent` (bad JSON,
   * schema mismatch). Without this prop the transport silently increments a
   * `agentui.event.parse_error_count` metric and the event is dropped — use
   * `onInvalidEvent` to log or surface the failure. Note: valid custom wire
   * events (any non-reserved `op`) do NOT come through here; they reach
   * `subscribeAction` like protocol events. See the "Custom wire events"
   * guide.
   */
  onInvalidEvent?: (raw: unknown, err: Error) => void;
  id?: string;
  children: ReactNode;
  /** Per-slice memory caps with drop-oldest eviction. */
  caps?: CapsConfig;
  /** Receives every emitted metric. */
  onMetric?: (m: Metric) => void;
  /** Tags applied to every metric. */
  tags?: Record<string, string>;
}

function storageKey(id: string | undefined, key: string): string {
  return `agentui:${id ?? "default"}:${key}`;
}

// Module-scoped so SSR and multi-instance pages don't spam the console.
let warnedDeprecatedProps = false;

/**
 * Single mount-point for AgentUI session lifecycle, stream wiring, and action
 * dispatching. Wraps children in session, agent-state, and action contexts.
 */
export function AgentRoot({
  transport: transportProp,
  endpoint: endpointProp,
  fetch: fetchProp,
  storage = localStorageAdapter,
  autoConnect = true,
  onError,
  onInvalidEvent,
  id,
  children,
  caps,
  onMetric,
  tags,
}: AgentRootProps) {
  if (
    transportProp === undefined &&
    endpointProp === undefined
  ) {
    throw new Error(
      "[agentui] <AgentRoot> requires `transport` (preferred) or `endpoint`.",
    );
  }

  if (
    transportProp === undefined &&
    !warnedDeprecatedProps &&
    typeof console !== "undefined"
  ) {
    warnedDeprecatedProps = true;
    console.warn(
      "[agentui] `endpoint`/`fetch` props on <AgentRoot> are deprecated. " +
        "Pass `transport={httpTransport({ endpoint, fetch })}` instead. " +
        "Removed in v2.0.",
    );
  }

  const metricsEmitter = useMemo(
    () => createMetricEmitter(onMetric, tags ?? {}),
    [onMetric, tags],
  );

  // Resolve the transport once per (transport, endpoint, fetch) tuple. When
  // the caller passes their own transport we use it as-is; otherwise we
  // construct the default HTTP transport from the deprecated props.
  const transport = useMemo<Transport>(() => {
    if (transportProp !== undefined) return transportProp;
    return httpTransport({
      endpoint: endpointProp as string,
      fetch: fetchProp,
      metrics: metricsEmitter,
    });
  }, [transportProp, endpointProp, fetchProp, metricsEmitter]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<AgentError | null>(null);
  const [sessionStatus, setSessionStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >(autoConnect ? "connecting" : "idle");

  const seqRef = useRef(0);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fireError = useCallback((err: AgentError) => {
    setError(err);
    onErrorRef.current?.(err);
  }, []);

  const create = useCallback(async (): Promise<void> => {
    const seq = ++seqRef.current;
    setError(null);
    setSessionStatus("connecting");
    const startMs = performance.now();
    try {
      const { sessionId: sid } = await transport.createSession({});
      if (seq !== seqRef.current) return;
      setSessionId(sid);
      metricsEmitter.timing(
        "agentui.session.create_ms",
        performance.now() - startMs,
        { sessionId: hashSessionId(sid) },
      );
    } catch (cause) {
      if (seq !== seqRef.current) return;
      fireError({
        kind: "session-create",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
      setSessionStatus("error");
    }
  }, [transport, fireError, metricsEmitter]);

  const resume = useCallback(
    async (conversationIdToResume: string): Promise<void> => {
      const seq = ++seqRef.current;
      setError(null);
      setSessionStatus("connecting");
      const startMs = performance.now();
      try {
        const { sessionId: sid } = await transport.createSession({
          conversationId: conversationIdToResume,
        });
        if (seq !== seqRef.current) return;
        setSessionId(sid);
        setConversationId(conversationIdToResume);
        metricsEmitter.timing(
          "agentui.session.create_ms",
          performance.now() - startMs,
          { sessionId: hashSessionId(sid) },
        );
      } catch (cause) {
        if (cause instanceof SessionNotFoundError) {
          await storage.remove(storageKey(id, "conversationId"));
          if (seq !== seqRef.current) return;
          fireError({
            kind: "session-resume",
            message: `Resume failed (404); falling back to fresh session.`,
            cause,
          });
          await create();
          return;
        }
        if (seq !== seqRef.current) return;
        fireError({
          kind: "session-resume",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
        setSessionStatus("error");
      }
    },
    [transport, fireError, storage, id, create, metricsEmitter],
  );

  const handleEvent = useCallback(
    (event: AgentWireEvent) => {
      if (event.op === "session.meta") {
        setConversationId(event.conversationId);
        void Promise.resolve(
          storage.set(storageKey(id, "conversationId"), event.conversationId),
        ).catch(() => {
          /* swallow */
        });
      }
    },
    [storage, id],
  );

  const stream = useAgentStream({
    transport,
    sessionId: sessionId ?? "",
    enabled: sessionId !== null,
    onEvent: handleEvent,
    onInvalidEvent,
    caps,
    metrics: metricsEmitter,
  });

  const combinedStatus: "idle" | "connecting" | "connected" | "error" =
    error !== null
      ? "error"
      : sessionId === null
        ? sessionStatus
        : stream.status === "open"
          ? "connected"
          : stream.status === "error" || stream.status === "closed"
            ? "error"
            : "connecting";

  const reset = useCallback(async (): Promise<void> => {
    await storage.remove(storageKey(id, "conversationId"));
    stream.reset();
    setConversationId(null);
    setSessionId(null);
    await create();
  }, [storage, id, stream, create]);

  const close = useCallback(() => {
    stream.close();
    setSessionStatus("idle");
  }, [stream]);

  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    if (!autoConnect) {
      setSessionStatus("idle");
      return;
    }
    void (async () => {
      const persisted = await Promise.resolve(storage.get(storageKey(id, "conversationId")));
      if (persisted !== null && persisted !== "") {
        await resume(persisted);
      } else {
        await create();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionValue: UseAgentSessionResult = {
    sessionId,
    conversationId,
    status: combinedStatus,
    error,
    create,
    resume,
    reset,
    close,
  };

  const actionSender = useCallback<ActionSender>(
    async (action) => {
      await transport.dispatchAction({ action });
    },
    [transport],
  );

  // `endpoint`/`fetch` on config are deprecated but kept for one minor cycle
  // so third-party hooks that read them keep compiling. Default values when
  // a custom transport is supplied without an HTTP-style endpoint.
  const configValue = useMemo(
    () => ({
      transport,
      endpoint: endpointProp ?? "",
      fetch: fetchProp ?? globalThis.fetch.bind(globalThis),
    }),
    [transport, endpointProp, fetchProp],
  );

  // Multi-agent registry: read parent, check for duplicate id, build my entry.
  const parentEntry = useContext(AgentRootRegistry);

  useEffect(() => {
    if (id === undefined || parentEntry === null) return;
    let walk: AgentRootRegistryEntry | null = parentEntry;
    while (walk !== null) {
      if (walk.id === id) {
        throw new Error(
          `[agentui] Duplicate <AgentRoot id="${id}"> in the same tree. ` +
            "Ids must be unique within a nested AgentRoot chain.",
        );
      }
      walk = walk.parent;
    }
  }, [id, parentEntry]);

  const registryEntry = useMemo<AgentRootRegistryEntry>(
    () => ({
      id,
      session: sessionValue,
      config: configValue,
      store: stream.store,
      actionSender,
      parent: parentEntry,
    }),
    [id, sessionValue, configValue, stream.store, actionSender, parentEntry],
  );

  return (
    <AgentRootRegistry.Provider value={registryEntry}>
      <SessionProvider value={sessionValue} config={configValue}>
        <AgentStateProvider store={stream.store}>
          <AgentActionProvider sender={actionSender}>{children}</AgentActionProvider>
        </AgentStateProvider>
      </SessionProvider>
    </AgentRootRegistry.Provider>
  );
}
