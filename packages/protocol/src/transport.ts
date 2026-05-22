import type { ActionEvent, AgentWireEvent } from "./index.js";

/**
 * A single conversation turn returned by {@link Transport.getHistory}.
 *
 * v1.x: content is flattened to a single `text` field. Structured content
 * (tool-use blocks, images, multi-part messages) is not represented — if/when
 * servers need to return richer history, this shape will widen in a major.
 */
export interface HistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ts: string;
}

/** Lifecycle callbacks for an open stream. */
export interface StreamHandlers {
  /** Fired once the underlying connection is established. */
  onOpen: () => void;
  /**
   * Fired for every successfully parsed wire event. `id` is the
   * transport-level event id (SSE `id:` field for HTTP) if the transport
   * supplies one, otherwise undefined.
   */
  onEvent: (event: AgentWireEvent, id: string | undefined) => void;
  /**
   * Fired when the transport delivered a payload that could not be parsed
   * into an AgentWireEvent (bad JSON, schema mismatch). Optional — transports
   * that have no parse boundary (e.g. pure in-process) never call this.
   */
  onInvalidEvent?: (raw: unknown, err: Error) => void;
  /**
   * Fired for transport-level failures (HTTP error, network drop, etc.).
   * Consumers can `instanceof TransportHttpError` to inspect the status code
   * — this is how auth-aware re-connect logic detects 401s.
   */
  onError: (err: Error) => void;
}

/**
 * Transport abstraction: how an AgentUI client talks to its backend.
 *
 * The default implementation, {@link httpTransport} (in
 * `@kibadist/agentui-react`), maps these methods to HTTP routes under a
 * single endpoint. Custom transports can plug in any wire (in-process,
 * WebSocket, BroadcastChannel for tests, RN bridge) without monkey-patching
 * fetch — the protocol logic (parsing, reducer dispatch, retry/backoff,
 * auth retry) sits above this interface and is reused unchanged.
 *
 * All methods receive an optional `signal` so consumers can cancel in-flight
 * work on unmount.
 */
export interface Transport {
  /**
   * Create a new session, or resume one keyed by `conversationId`. Resolves
   * with the server-issued sessionId; throws {@link SessionNotFoundError} if
   * a resume target no longer exists, or {@link TransportHttpError} (or any
   * transport-defined Error) on other failures.
   */
  createSession(opts: {
    conversationId?: string;
    signal?: AbortSignal;
  }): Promise<{ sessionId: string }>;

  /**
   * Open the wire-event stream for `sessionId`. The returned Promise:
   * - **resolves** on clean stream end — server EOF, abort via `signal`, or
   *   any non-error termination. Resolution alone does not imply success;
   *   inspect whether `onError` fired to disambiguate clean close from
   *   error-then-close.
   * - **never rejects.** All failures (HTTP errors, network drops, parse
   *   errors) surface through `onError` / `onInvalidEvent` so the caller
   *   can drive its own retry/backoff loop without try/catch wrappers.
   *
   * `lastEventId` lets the transport resume from where the previous stream
   * left off; HTTP transports forward it as the SSE `Last-Event-ID` header.
   */
  openStream(
    opts: {
      sessionId: string;
      lastEventId?: string;
      /**
       * Per-attempt request headers. HTTP transports add these to the SSE GET —
       * the canonical use is `{ Authorization: "Bearer ..." }` driven by
       * `useAgentStream`'s `auth` config so token-refresh + reconnect work.
       * Non-HTTP transports may ignore this field.
       */
      headers?: Record<string, string>;
      signal: AbortSignal;
    } & StreamHandlers,
  ): Promise<void>;

  /**
   * Send a user action to the agent. Throws {@link TransportHttpError} on
   * non-2xx responses (HTTP transport) or any transport-defined Error on
   * delivery failure.
   */
  dispatchAction(opts: {
    action: ActionEvent;
    signal?: AbortSignal;
  }): Promise<void>;

  /**
   * Load conversation history for `sessionId`. Returns an empty messages
   * array on 404 (HTTP transport) — i.e. "no history yet" is not an error.
   * Other failures throw.
   */
  getHistory(opts: {
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<{ messages: HistoryMessage[] }>;
}

/**
 * Thrown by HTTP-style transports when an underlying request returns a
 * non-2xx status. `status` is part of the public contract: callers detect
 * 401s for auth-aware retry by checking `err instanceof TransportHttpError
 * && err.status === 401`.
 */
export class TransportHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    message?: string,
  ) {
    super(message ?? `Transport HTTP ${status}: ${statusText}`);
    this.name = "TransportHttpError";
  }
}

/**
 * Thrown by {@link Transport.createSession} when a resume attempt targets a
 * conversation the server no longer knows about. AgentRoot catches this and
 * falls back to a fresh session.
 */
export class SessionNotFoundError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Session for conversation ${conversationId} not found`);
    this.name = "SessionNotFoundError";
  }
}
