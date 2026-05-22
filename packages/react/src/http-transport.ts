import type {
  AgentWireEvent,
  HistoryMessage,
  StreamHandlers,
  Transport,
} from "@kibadist/agentui-protocol";
import {
  SessionNotFoundError,
  TransportHttpError,
} from "@kibadist/agentui-protocol";
import { safeParseAgentEvent } from "@kibadist/agentui-validate";
import { connectSse } from "./sse-transport.js";
import type { MetricEmitter } from "./metrics.js";

export interface HttpTransportConfig {
  /** Base URL — all four endpoints (`/session`, `/stream`, `/action`, `/history`) are appended. */
  endpoint: string;
  /**
   * Optional fetch wrapper. Defaults to `globalThis.fetch`. Pass a wrapped
   * fetch (e.g. `(input, init) => fetch(input, { ...init, credentials: "include" })`,
   * or your project's `callApiClient`) and every HTTP request the transport
   * makes — including the SSE stream GET — flows through it.
   */
  fetch?: typeof fetch;
  /**
   * Optional metric emitter. When set, the transport emits
   * `agentui.event.parse_ms` for every wire event it parses. Connection and
   * dispatch timings are emitted by `useAgentStream` at the hook level —
   * this hook is only for transport-internal timings.
   */
  metrics?: MetricEmitter;
}

function normalize(endpoint: string): string {
  return endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
}

/**
 * Default HTTP transport: maps the four {@link Transport} methods onto
 * `POST /session`, `GET /stream` (SSE), `POST /action`, `GET /history`
 * under a single configurable base endpoint.
 *
 * Returned object is a plain Transport — pass it to
 * `<AgentRoot transport={...}>` or to `useAgentStream({ transport, ... })`.
 */
export function httpTransport(config: HttpTransportConfig): Transport {
  const endpoint = normalize(config.endpoint);
  const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  const metrics = config.metrics;

  return {
    async createSession({ conversationId, signal }) {
      const url =
        conversationId === undefined
          ? `${endpoint}/session`
          : `${endpoint}/session?conversationId=${encodeURIComponent(conversationId)}`;
      const res = await doFetch(url, { method: "POST", signal });
      if (res.status === 404 && conversationId !== undefined) {
        throw new SessionNotFoundError(conversationId);
      }
      if (!res.ok) {
        throw new TransportHttpError(res.status, res.statusText);
      }
      const data = (await res.json()) as { sessionId: string };
      return { sessionId: data.sessionId };
    },

    async openStream({ sessionId, lastEventId, headers, signal, ...handlers }) {
      const sep = endpoint.includes("?") ? "&" : "?";
      const url = `${endpoint}/stream${sep}sessionId=${encodeURIComponent(sessionId)}`;
      await connectSse({
        url,
        fetch: doFetch,
        headers,
        lastEventId,
        signal,
        onOpen: handlers.onOpen,
        onError: handlers.onError,
        onEvent: (raw, id) => emitParsed(raw, id, handlers, metrics),
      });
    },

    async dispatchAction({ action, signal }) {
      const res = await doFetch(`${endpoint}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
        signal,
      });
      if (!res.ok) {
        throw new TransportHttpError(res.status, res.statusText);
      }
    },

    async getHistory({ sessionId, signal }) {
      const url = `${endpoint}/history?sessionId=${encodeURIComponent(sessionId)}`;
      const res = await doFetch(url, { method: "GET", signal });
      if (res.status === 404) {
        return { messages: [] };
      }
      if (!res.ok) {
        throw new TransportHttpError(res.status, res.statusText);
      }
      const data = (await res.json()) as { messages?: HistoryMessage[] };
      return { messages: data.messages ?? [] };
    },
  };
}

function emitParsed(
  raw: string,
  id: string | undefined,
  handlers: StreamHandlers,
  metrics: MetricEmitter | undefined,
): void {
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(raw);
  } catch (err) {
    handlers.onInvalidEvent?.(raw, err as Error);
    return;
  }
  const parseStart = performance.now();
  const result = safeParseAgentEvent(parsedRaw);
  metrics?.timing("agentui.event.parse_ms", performance.now() - parseStart, {
    eventOp: (parsedRaw as { op?: string }).op ?? "unknown",
  });
  if (result.ok) {
    handlers.onEvent(result.value as AgentWireEvent, id);
  } else {
    handlers.onInvalidEvent?.(parsedRaw, result.error);
  }
}
