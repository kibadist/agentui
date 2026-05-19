---
ticket: DET-149
title: Stream resilience — retry/backoff, backpressure, auth-aware reconnect
version_target: 0.7.0
date: 2026-05-19
---

# Stream Resilience — Design Spec

## 1. Goal

Today the SSE client uses native `EventSource`, which auto-reconnects opaquely and forever, has no header support (no auth refresh), and applies zero backpressure. v0.7 replaces this with a fetch-based SSE transport plus three opt-in configs:

1. **`retry`** — explicit backoff + max attempts + jitter (vs. `EventSource`'s opaque infinite retry).
2. **`buffer`** — bounded event buffer with named overflow strategies (vs. unbounded).
3. **`auth`** — token-refresh hook + `Last-Event-ID` resume (vs. nothing — native EventSource can't send headers at all).

All three are opt-in. With **no config**, default behavior is "infinite retry, no buffer cap, no auth header." A consumer who supplies none of these gets the same observable behavior they have today.

## 2. New Transport

### 2.1 Decision: replace EventSource entirely

We drop native `EventSource` and adopt a fetch-based SSE reader. Rationale:

- `EventSource` cannot send `Authorization: Bearer ...` headers in browsers. Auth-aware reconnect cannot ride on top of it.
- `EventSource` cannot send `Last-Event-ID` as a header on the *first* connection of a refresh cycle; it only does so on its automatic retry. We need it to flow on **any** reconnect we initiate.
- `EventSource`'s retry timing is undocumented and not testable.

The fetch-based transport handles all three features uniformly. Maintaining one transport beats branching on config.

### 2.2 Transport contract

New file `packages/react/src/sse-transport.ts` exports:

```ts
export interface SseTransportOptions {
  url: string;
  headers?: Record<string, string>;
  lastEventId?: string;
  signal: AbortSignal;
  onEvent: (raw: string, id: string | undefined) => void;
  onOpen: () => void;
  onError: (err: Error) => void;
}

/**
 * Connect to an SSE endpoint via fetch. Reads the body stream, parses SSE
 * frames, and dispatches each `data:` payload to `onEvent`. Returns when
 * the stream ends, errors, or `signal` is aborted.
 */
export function connectSse(opts: SseTransportOptions): Promise<void>;
```

Single-pass SSE frame parser inline in this file (~80 lines). No external dep. Supports `data:`, `id:`, `event:`, `:` (comment / heartbeat), `retry:` (ignored — we control retry).

If `fetch` doesn't support streaming (very old browsers), the function throws on the first read — `useAgentStream` catches and reports `error` status. We don't ship a polyfill.

## 3. New StreamStatus

```ts
export type StreamStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reauthenticating"   // NEW — waiting for auth.getToken() to resolve
  | "reconnecting"        // NEW — waiting out backoff between attempts
  | "closed"
  | "error";              // terminal: maxAttempts exhausted or fatal transport failure
```

`reconnecting` is reported while the hook sleeps the backoff delay. `reauthenticating` is reported while `auth.getToken()` is pending. Both transition to `connecting` next.

Migration: hosts switching on `StreamStatus` need a default branch (TypeScript `--noFallthroughCasesInSwitch` flags this). Mentioned in release notes.

## 4. Retry / Backoff

### 4.1 API

```ts
useAgentStream({
  url, sessionId,
  retry: {
    maxAttempts: 5,         // default Infinity
    initialDelayMs: 500,    // default 500
    maxDelayMs: 30_000,     // default 30_000
    jitter: "full",          // "full" | "equal" | "none", default "full"
    onGiveUp?: (err: Error) => void,
  },
});
```

If `retry` is undefined, defaults above apply (so existing behavior keeps reconnecting forever, which is what native EventSource did).

### 4.2 Backoff formula

Exponential with the chosen jitter strategy. Attempt `n` (0-indexed):

```
raw = min(initialDelayMs * 2^n, maxDelayMs)
```

- `jitter: "none"` → `delay = raw`
- `jitter: "full"` → `delay = random(0, raw)` (per AWS Architecture Blog)
- `jitter: "equal"` → `delay = raw/2 + random(0, raw/2)`

Internal helper `computeBackoff(attempt, opts, rng = Math.random)` is **pure** — `rng` injectable for tests.

### 4.3 Give-up

When attempt counter reaches `maxAttempts`:
- `onGiveUp(lastError)` is invoked once (synchronous)
- Status transitions to `error` and stays there until the consumer changes `url`, `sessionId`, or `enabled` (which triggers a new effect cycle and resets the counter).

A successful `open` resets the attempt counter to 0.

## 5. Backpressure

### 5.1 API

```ts
useAgentStream({
  url, sessionId,
  buffer: {
    max: 1000,                                        // default Infinity
    onOverflow: "drop-oldest",                        // "drop-oldest" | "drop-newest" | "block-stream" | "callback"
    onOverflowCallback?: (dropped: AgentWireEvent) => void,
  },
});
```

If `buffer` is undefined, no buffer cap — events are dispatched as they arrive (matches current behavior).

### 5.2 Buffer mechanics

Between the transport's `onEvent` and the reducer's `store.send`, we interpose an in-memory queue drained via `requestAnimationFrame` (1 frame = 1 batch). The queue caps at `max`.

Overflow strategies (mutually exclusive — set exactly one):

- `drop-oldest` — pop from the head; push to the tail. The newly-arrived event always wins.
- `drop-newest` — when full, the newly-arrived event is dropped (queue unchanged).
- `block-stream` — the SSE reader pauses (we stop calling `fetch.body.getReader().read()`) until the buffer drains below `max`. Implemented via a pending Promise the reader awaits. No events are dropped.
- `callback` — alias of `drop-newest` that also reports each dropped event to `onOverflowCallback`.

`onOverflowCallback` is a separate field that fires whenever an event is dropped, regardless of strategy. With `drop-oldest`, the **evicted** event is reported; with `drop-newest`/`callback`, the **incoming** event is reported; with `block-stream`, the callback never fires (no drops). When the callback is set without an explicit strategy, the default strategy is `drop-newest`.

### 5.3 Drain rate

One `requestAnimationFrame` per drain. Each drain dispatches up to `max` events. Rationale: React batches updates within a frame anyway; this lets the reducer + render keep pace.

In non-browser environments (SSR, tests under Node), the rAF polyfill is `setTimeout(fn, 0)`.

## 6. Auth-Aware Reconnect

### 6.1 API

```ts
useAgentStream({
  url, sessionId,
  auth: {
    getToken: () => Promise<string>,
    onUnauthorized?: () => Promise<void>,
  },
});
```

`getToken` is called before every connection attempt. Its result becomes the `Authorization: Bearer ${token}` header.

`onUnauthorized` is called when the server returns HTTP 401 OR sends a structured `error` SSE event with `code: "unauthorized"`. The host typically refreshes its session here.

### 6.2 Flow on 401

1. Transport sees 401 (or unauthorized error event)
2. Hook sets status to `reauthenticating`
3. `onUnauthorized()` awaited (host may navigate to login, refresh tokens, etc.)
4. `getToken()` awaited (returns the new token)
5. New connection attempt with the new header + `Last-Event-ID` set to the highest `id:` seen so far
6. Status transitions to `connecting` → `open`

If either of `onUnauthorized` or `getToken` throws, the error counts as a retry failure (subject to `retry` config).

### 6.3 Last-Event-ID

The hook tracks the highest `id:` seen across the session. On any reconnect (retry-driven or auth-driven), the next attempt sends `Last-Event-ID: <id>`. Server cooperation required — documented in §10.

If a connection completes without ever receiving an `id:`, the field stays `undefined` and the next reconnect omits the header. (Resumption is opportunistic.)

## 7. Hook Surface — Updated

New options struct:

```ts
export interface UseAgentStreamOptions {
  url: string;
  sessionId: string;
  onEvent?: (event: AgentWireEvent) => void;
  onInvalidEvent?: (raw: unknown, error: Error) => void;
  enabled?: boolean;
  retry?: RetryConfig;
  buffer?: BufferConfig;
  auth?: AuthConfig;
}
```

`UseAgentStreamResult` unchanged: `{ state, status, close, reset, dispatch, store }`. Status enum is broader.

## 8. File Layout

```
packages/react/src/
├── use-agent-stream.ts        # MAJOR REWRITE — orchestrator
├── sse-transport.ts           # NEW — fetch-based SSE reader + frame parser
├── stream-backoff.ts          # NEW — pure backoff computation
├── stream-buffer.ts           # NEW — bounded queue with overflow strategies
└── index.ts                   # MODIFY — re-export new config types

packages/react/test/
├── stream-backoff.test.ts     # NEW
├── stream-buffer.test.ts      # NEW
├── sse-transport.test.ts      # NEW (with mock fetch)
└── use-agent-stream.test.ts   # NEW — integration tests for retry, auth, buffer flows
```

Each new file has a single responsibility:
- `sse-transport.ts` — connect once, read frames, callback per event. Knows nothing about retry/auth.
- `stream-backoff.ts` — pure function `computeBackoff(attempt, opts, rng)`.
- `stream-buffer.ts` — `createBuffer(opts)` returning `{ enqueue(evt), drain(cb), clear() }`.
- `use-agent-stream.ts` — composes the three. Owns the state machine.

## 9. Testing

### 9.1 `stream-backoff.test.ts`

- `jitter: "none"`: exact exponential 500, 1000, 2000, 4000, ..., capped at maxDelayMs
- `jitter: "full"` with `rng=()=>0.5`: half of raw
- `jitter: "equal"` with `rng=()=>0`: raw/2; with `rng=()=>1`: raw
- Cap: attempt 100 with maxDelayMs=30000 returns 30000

### 9.2 `stream-buffer.test.ts`

- `drop-oldest`: push 2000 events with max=1000 → final buffer is the last 1000; oldest 1000 reported to callback
- `drop-newest`: push 2000 events with max=1000 → final buffer is the first 1000; latest 1000 reported to callback
- `block-stream`: returns a "wait" promise that resolves when buffer drains; pushing after wait succeeds
- `callback` only (no strategy set explicitly): defaults to `drop-newest` semantics, callback fires
- `drain`: pops up to N events, invokes the dispatch callback in order

### 9.3 `sse-transport.test.ts`

Uses `vi.fn()` to mock `fetch` with a synthetic `Response` whose body is a `ReadableStream`.

- Single-event happy path: `data: {"foo":1}\n\n` → `onEvent("{\"foo\":1}", undefined)`
- Event with id: `id: abc\ndata: ...\n\n` → second arg is `"abc"`
- Multi-event: two events parsed in order
- Heartbeat (`:keepalive\n`) is ignored
- Multi-line data: `data: line1\ndata: line2\n\n` → "line1\nline2"
- 401 response → `onError(Error)` with a recognizable code

### 9.4 `use-agent-stream.test.ts`

Integration tests with a `vi.fn()`-mocked `connectSse`:

- **Retry happy path:** transport fails twice (synthetic errors), succeeds on attempt 3; status sequence is `connecting → reconnecting → connecting → reconnecting → connecting → open`. Test uses `vi.useFakeTimers()` + `await vi.runAllTimersAsync()`.
- **Give-up:** transport always fails; `maxAttempts: 3` → `onGiveUp` called once → status stays `error`.
- **Auth flow:** first connect sets `Authorization: Bearer t1`; transport reports 401; `onUnauthorized` resolves; second connect uses `Authorization: Bearer t2`; Last-Event-ID forwarded.
- **Buffer drop-oldest:** push 50 events with max=10; reducer state shows only the last 10 nodes.
- **Reset on new URL:** changing `url` resets attempt counter and tears down old transport.

## 10. Server-Side Contract (Documented)

The README's "Stream resilience" section will note:

- Server SHOULD include an `id:` line on every event for resumption.
- On reconnect with `Last-Event-ID: <id>`, server SHOULD replay buffered events with ids greater than `<id>` (if it has them).
- Server MAY return HTTP 401 to trigger auth-aware refresh.
- Without these, the client still works — just no event resumption.

The existing NestJS controller factory in `@kibadist/agentui-nest` does NOT implement event id assignment in v0.7. That's a follow-up.

## 11. Out of Scope

- Server-side replay implementation in `@kibadist/agentui-nest`
- WebSocket fallback
- Compression
- Per-event ack from client to server
- Browser-storage-backed event persistence across page reloads
- Telemetry hooks (`onReconnect`, `onLatency`, etc.) — separate ticket

## 12. Acceptance Criteria

- `pnpm test` passes including the 4 new test files
- `pnpm typecheck` clean (new StreamStatus members exhaustively handled where switched on)
- A consumer with NO `retry`/`buffer`/`auth` keys gets behavior observably equivalent to current native EventSource (infinite retry, no buffer cap)
- A consumer with `retry: { maxAttempts: 3 }` gives up after 3 failed attempts and stays in `error`
- A consumer with `auth: { getToken, onUnauthorized }` recovers from a 401 without consumer intervention
