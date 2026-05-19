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
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { AgentActionProvider, type ActionSender } from "./action-context.js";
import { AgentStateProvider } from "./agent-state-context.js";
import {
  AgentRootRegistry,
  type AgentRootRegistryEntry,
} from "./agent-root-registry.js";
import { SessionProvider, type UseAgentSessionResult } from "./session-context.js";
import { useAgentStream } from "./use-agent-stream.js";
import { localStorageAdapter, type SessionStorageAdapter } from "./storage-adapter.js";
import type { AgentError } from "./agent-error.js";

export interface AgentRootProps {
  endpoint: string;
  storage?: SessionStorageAdapter;
  fetch?: typeof fetch;
  autoConnect?: boolean;
  onError?: (err: AgentError) => void;
  id?: string;
  children: ReactNode;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
}

function storageKey(id: string | undefined, key: string): string {
  return `agentui:${id ?? "default"}:${key}`;
}

/**
 * Single mount-point for AgentUI session lifecycle, stream wiring, and action
 * dispatching. Wraps children in session, agent-state, and action contexts.
 */
export function AgentRoot({
  endpoint: endpointProp,
  storage = localStorageAdapter,
  fetch: fetchProp,
  autoConnect = true,
  onError,
  id,
  children,
}: AgentRootProps) {
  const endpoint = normalizeEndpoint(endpointProp);
  // Memoize doFetch so the configValue identity is stable across renders
  // when no custom fetchProp is passed. Without this, globalThis.fetch.bind(...)
  // creates a fresh function each render and thrashes context consumers.
  const doFetch = useMemo(
    () => fetchProp ?? globalThis.fetch.bind(globalThis),
    [fetchProp],
  );

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
    try {
      const res = await doFetch(`${endpoint}/session`, { method: "POST" });
      if (!res.ok) {
        if (seq !== seqRef.current) return;
        fireError({
          kind: "session-create",
          message: `Session create failed: ${res.status} ${res.statusText}`,
          cause: res,
        });
        setSessionStatus("error");
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      if (seq !== seqRef.current) return;
      setSessionId(data.sessionId);
    } catch (cause) {
      if (seq !== seqRef.current) return;
      fireError({
        kind: "session-create",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
      setSessionStatus("error");
    }
  }, [endpoint, doFetch, fireError]);

  const resume = useCallback(
    async (conversationIdToResume: string): Promise<void> => {
      const seq = ++seqRef.current;
      setError(null);
      setSessionStatus("connecting");
      try {
        const url = `${endpoint}/session?conversationId=${encodeURIComponent(
          conversationIdToResume,
        )}`;
        const res = await doFetch(url, { method: "POST" });
        if (res.status === 404) {
          await storage.remove(storageKey(id, "conversationId"));
          if (seq !== seqRef.current) return;
          fireError({
            kind: "session-resume",
            message: `Resume failed (404); falling back to fresh session.`,
            cause: res,
          });
          await create();
          return;
        }
        if (!res.ok) {
          if (seq !== seqRef.current) return;
          fireError({
            kind: "session-resume",
            message: `Session resume failed: ${res.status} ${res.statusText}`,
            cause: res,
          });
          setSessionStatus("error");
          return;
        }
        const data = (await res.json()) as { sessionId: string };
        if (seq !== seqRef.current) return;
        setSessionId(data.sessionId);
        setConversationId(conversationIdToResume);
      } catch (cause) {
        if (seq !== seqRef.current) return;
        fireError({
          kind: "session-resume",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
        setSessionStatus("error");
      }
    },
    [endpoint, doFetch, fireError, storage, id, create],
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
    url: `${endpoint}/stream`,
    sessionId: sessionId ?? "",
    enabled: sessionId !== null,
    onEvent: handleEvent,
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
      const res = await doFetch(`${endpoint}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!res.ok) {
        throw new Error(`Action failed: ${res.status} ${res.statusText}`);
      }
    },
    [doFetch, endpoint],
  );

  const configValue = useMemo(
    () => ({ endpoint, fetch: doFetch }),
    [endpoint, doFetch],
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
