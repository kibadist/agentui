# `<AgentRoot>` session lifecycle provider (DET-142 / v0.5.4)

Linear: [DET-142 — v0.5 — `<AgentRoot>` session lifecycle provider](https://linear.app/detailing-app/issue/DET-142)

## Goal

Ship a single mount-point that bundles session creation, conversation persistence, history rehydration, stream wiring, and error handling. Hosts replace ~80 lines of plumbing with `<AgentRoot endpoint="/api/agent">`. The existing `useAgentStream` keeps working standalone for power users.

## Non-goals (deliberate)

- Full multi-agent context isolation. The `id?` prop is in place (namespaces storage keys) but real multi-instance semantics ship in DET-143 (v0.5.5).
- Path-segment stream URL (`{endpoint}/{sessionId}/stream`). Default is query-param (`{endpoint}/stream?sessionId=...`) matching the existing `useAgentStream` convention. Revisit if hosts need an override.
- Conversation list, past-conversation switching, multi-conversation history. One conversation at a time.
- WebSocket fallback (SSE only — separate ticket DET-149).
- Auth wrappers, CSRF, cookies. Hosts inject via the `fetch` prop.
- Live message-history streaming. `useAgentHistory()` is on-demand; live state flows via selector hooks during the stream.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ <AgentRoot endpoint="/api/agent" storage={...}>                  │
│                                                                  │
│   1. mount: read persisted conversationId from storage           │
│   2. POST {endpoint}/session?conversationId={persisted}          │
│   3. response.sessionId → start useAgentStream({                 │
│        url: `${endpoint}/stream`, sessionId                      │
│      })                                                          │
│   4. SSE onmessage → if op === "session.meta":                   │
│        storage.set("conversationId", e.conversationId)           │
│   5. on reset(): storage.remove(...); dispatch __reset__;        │
│        repeat from (2) WITHOUT conversationId                    │
│                                                                  │
│   ┌────────────────────────────────────────────────────────┐    │
│   │ <SessionContext>                                       │    │
│   │   <AgentStateProvider store={stream.store}>            │    │
│   │     <AgentActionProvider sender={fetchAction}>         │    │
│   │       {children}                                       │    │
│   │     </AgentActionProvider>                             │    │
│   │   </AgentStateProvider>                                │    │
│   │ </SessionContext>                                      │    │
│   └────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

Children get three contexts wired automatically — `useAgentSession`, `useAgentHistory`, plus every existing selector hook (`useAgentNodes`, `useToolCalls`, `useOptimistic`, etc.).

## Public API

### `<AgentRoot>` component

```ts
export interface AgentRootProps {
  /** Base URL for session/stream/history endpoints. */
  endpoint: string;
  /** Pluggable storage; defaults to localStorage when available. */
  storage?: SessionStorageAdapter;
  /** Injectable fetch (auth wrappers, mocks). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** If false, host calls `useAgentSession().create()` manually. Default: true. */
  autoConnect?: boolean;
  /** Surface fatal session/stream/history errors. */
  onError?: (err: AgentError) => void;
  /** Multi-agent id (DET-143). For v0.5.4 only namespaces storage keys. */
  id?: string;
  children: ReactNode;
}

export function AgentRoot(props: AgentRootProps): JSX.Element;
```

### Storage adapter

```ts
export interface SessionStorageAdapter {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

/** Default web adapter. Safe in SSR — falls back to no-op if localStorage is undefined. */
export const localStorageAdapter: SessionStorageAdapter;
```

The library `await`s storage operations so both sync (web) and async (RN AsyncStorage) adapters work.

### Session hook

```ts
export interface UseAgentSessionResult {
  sessionId: string | null;
  conversationId: string | null;
  status: "idle" | "connecting" | "connected" | "error";
  error: AgentError | null;
  create: () => Promise<void>;
  resume: (conversationId: string) => Promise<void>;
  reset: () => Promise<void>;
  close: () => void;
}

export function useAgentSession(id?: string): UseAgentSessionResult;
```

The `id` parameter is forwarded from `<AgentRoot id={...}>`. For v0.5.4 ignoring `id` is a valid choice; full multi-agent context lookup is DET-143.

### History hook

```ts
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

export function useAgentHistory(id?: string): UseAgentHistoryResult;
```

On session start, `useAgentHistory` automatically fetches `GET {endpoint}/history?sessionId={sessionId}`. 404 returns `messages: []` without firing `onError` — "no history yet" is valid for fresh sessions.

### Error type

```ts
export interface AgentError {
  kind: "session-create" | "session-resume" | "history-fetch" | "stream";
  message: string;
  cause?: unknown;
}
```

Discriminated by `kind` so hosts can branch (e.g., show a retry button for `stream` but not for `session-create`).

### Wire event

```ts
// packages/protocol/src/index.ts (additions)
export interface SessionMetaEvent extends BaseEvent {
  op: "session.meta";
  /** Server-issued conversation id, persisted by <AgentRoot>. */
  conversationId: string;
}
```

`AgentWireEvent` widens to `UIEvent | ToolEvent | ReasoningEvent | OptimisticEvent | SessionMetaEvent`. The reducer's `default: return state` is sufficient — no state slice for session metadata. `<AgentRoot>` listens via the `onEvent` callback of its internal `useAgentStream` and persists the `conversationId` directly.

## Endpoint conventions

| Endpoint | Method | URL shape | Body / response |
|---|---|---|---|
| Session create/resume | `POST` | `{endpoint}/session?conversationId={persisted}` (omit param to create fresh) | Request: empty. Response: `{ sessionId: string }` |
| Stream | `GET` (SSE) | `{endpoint}/stream?sessionId={sessionId}` | Server-sent events |
| History | `GET` | `{endpoint}/history?sessionId={sessionId}` | `{ messages: HistoryMessage[] }` |

Endpoints with trailing slashes in the prop are normalized (the library strips a single trailing `/`).

**Why `conversationId` arrives via `session.meta` (SSE), not the POST response:**
The ticket assumes servers may lazily create conversations (e.g., on first user message). The POST returns `sessionId` immediately; the `conversationId` materializes later and is signaled over the stream. Servers that DO know the conversationId at POST time can still include it in the response body — the library ignores it. Documented.

## State machine

```
       ┌─────────────────────────────────────────────┐
       ↓                                             │
   ┌───────┐    autoConnect?       ┌─────────────┐  │
   │ idle  │────────────yes────────▶│ connecting │  │
   └───────┘                        └──────┬──────┘  │
       ▲                                   │         │
       │                  POST /session    │         │
       │ close()           fail            │         │
       │              ┌────────────────────┤         │
       │              │                    │         │
       │              ↓                    │success  │
       │         ┌────────┐                │         │
       │         │ error  │                ↓         │
       │         └────────┘          ┌───────────┐   │
       │              ▲ ─── ── ── ── │ connecting│   │
       │              │              │ (SSE)     │   │
       │              │              └────┬──────┘   │
       │  stream      │     SSE open      │          │
       │  error       │                   ↓          │
       │              │              ┌────────────┐  │
       │              │              │ connected  │──┘
       │              │              └────┬───────┘
       │              │                   │  resume
       │              │                   │  fails
       │              └──── ── ── ── ── ──┤
       │ reset()                          │
       └────                              ▼
                                    ┌────────────┐
                                    │  retry as  │
                                    │   create   │
                                    └─────┬──────┘
                                          │
                                          ▼ (back to connecting)
```

The combined `status` is derived from both the HTTP and SSE lifecycles:

```ts
const status: SessionStatus =
  error                              ? "error" :
  sessionId === null                 ? (autoConnect ? "connecting" : "idle") :
  streamStatus === "open"            ? "connected" :
  streamStatus === "error" ||
  streamStatus === "closed"          ? "error" :
                                       "connecting";
```

## Behavior contracts

**On mount (autoConnect: true, default):**
1. Read `conversationId` from storage (key: `agentui:${id ?? "default"}:conversationId`).
2. If present → call internal `resume(persisted)`.
3. Otherwise → call internal `create()`.

**`create()`:**
1. Set status to `connecting`.
2. `POST {endpoint}/session` with no `conversationId` query param.
3. On 2xx → parse `{ sessionId }`, set state, start stream.
4. On non-2xx → status `error`, fire `onError({ kind: "session-create", ... })`.

**`resume(conversationId)`:**
1. Set status to `connecting`.
2. `POST {endpoint}/session?conversationId={conversationId}`.
3. On 2xx → parse `{ sessionId }`, set state, start stream.
4. On **404** → `storage.remove(...)`; fire `onError({ kind: "session-resume", ... })`; then call `create()` automatically.
5. On other non-2xx → status `error`, fire `onError`.

**`reset()`:**
1. `storage.remove("conversationId")`.
2. Dispatch `__reset__` (clears in-memory state via the existing reducer path).
3. Call `create()`.

**`close()`:**
1. Stop the stream.
2. Status → `idle`.
3. Does NOT clear storage (use `reset()` for that).

**On `session.meta` event:**
1. `storage.set("conversationId", event.conversationId)`.
2. Update internal state so `useAgentSession().conversationId` reflects the new value.

## `useAgentHistory` behavior

- Reads sessionId from session context.
- If sessionId is null → returns `{ messages: [], loading: false, error: null, reload: noop }`.
- On sessionId becoming non-null → automatically fires the GET, sets `loading: true`.
- On 2xx → `messages: response.messages`, `loading: false`, `error: null`.
- On 404 → `messages: []`, `loading: false`, `error: null`. (No `onError` — empty history is valid.)
- On other non-2xx → `messages: []`, `loading: false`, `error: AgentError`. (Fires `onError`.)
- `reload()` re-fires the GET on demand.

## Storage key namespacing

`agentui:${id ?? "default"}:conversationId`

For v0.5.4 only `conversationId` is persisted. Future keys (e.g., `lastSeenIndex` for stream resumption) follow the same prefix.

## Tests

### `packages/validate/test/session-meta.test.ts` (2 tests)

1. Round-trip valid `session.meta` with `conversationId`.
2. Reject `session.meta` missing `conversationId`.

### `packages/react/test/agent-root.test.tsx` (5 tests)

Each test wires:
- `fetch` mock via the `fetch` prop (no global mutation).
- `storage` mock via an in-memory adapter.
- `MockEventSource` global (existing pattern from `use-agent-stream.test.tsx`).

1. **Fresh session.** Empty storage → POST `/session` (no conversationId) → fetch returns `{ sessionId: "s1" }` → SSE opens → `useAgentSession().status === "connected"`.
2. **Resume.** Storage pre-populated with `conversationId: "c1"` → POST `/session?conversationId=c1` → fetch returns 200 → SSE opens → consumer can read history via `useAgentHistory()` (covered separately).
3. **Resume 404 → fallback.** Storage pre-populated → POST returns 404 → storage cleared (assertion) → next POST has no conversationId param → 200 → connected. `onError` fires with `kind: "session-resume"`.
4. **`reset()` flow.** Start in connected state with `conversationId: "c1"` in storage → call `reset()` → storage cleared → `__reset__` dispatched (verified by `useAgentNodes()` going empty) → new POST fires without conversationId param.
5. **`session.meta` persistence.** Connected with no conversationId yet → server emits `{ op: "session.meta", conversationId: "c2" }` → storage receives `c2` → `useAgentSession().conversationId === "c2"`.

### `packages/react/test/use-agent-history.test.tsx` (3 tests)

1. **Happy path.** Mount with fake sessionId in context → GET `/history?sessionId=...` → fetch returns `{ messages: [...] }` → probe sees messages.
2. **404 → empty.** GET returns 404 → `messages: []`, `error: null`. `onError` NOT fired.
3. **`reload()`.** Initial fetch returns 1 message. Call `reload()`. Second fetch returns 2 messages. Probe sees the new list.

## File touches

| File | Action |
|---|---|
| `packages/protocol/src/index.ts` | Add `SessionMetaEvent`; widen `AgentWireEvent` |
| `packages/validate/src/schemas.ts` | Add `sessionMetaSchema`; widen `agentWireEventSchema` |
| `packages/react/src/agent-error.ts` | Create — `AgentError` interface |
| `packages/react/src/storage-adapter.ts` | Create — `SessionStorageAdapter` + `localStorageAdapter` |
| `packages/react/src/session-context.tsx` | Create — context type + `useAgentSession` |
| `packages/react/src/agent-root.tsx` | Create — `<AgentRoot>` component |
| `packages/react/src/use-agent-history.ts` | Create — `useAgentHistory` hook |
| `packages/react/src/reducer.ts` | Widen `AgentAction` to include `SessionMetaEvent` (type-only; reducer's `default` no-ops it) |
| `packages/react/src/index.ts` | New exports |
| `packages/validate/test/session-meta.test.ts` | Create — 2 schema tests |
| `packages/react/test/agent-root.test.tsx` | Create — 5 component tests |
| `packages/react/test/use-agent-history.test.tsx` | Create — 3 hook tests |
| `CHANGELOG.md` | Extend 0.5.0 with the AgentRoot section |
| `README.md` | New "Quick start with `<AgentRoot>`" section (positioned above the more detailed sections) |

## Edge cases

- **`autoConnect: false`.** AgentRoot mounts in `idle`; host must call `useAgentSession().create()`. Storage is NOT read until then.
- **No `localStorage` available (SSR, RN).** `localStorageAdapter` checks `typeof localStorage !== "undefined"` and falls back to in-memory no-op. Hosts pass an explicit `storage` prop in RN.
- **Concurrent `create()` / `resume()` calls.** AgentRoot tracks a monotonic sequence id; only the most-recent call's result is applied. Earlier in-flight requests are abandoned (their fetch promise resolves but result is ignored). Documented.
- **Component unmount mid-request.** `AbortController` cancels pending fetches. Storage writes are best-effort (already in-flight writes complete).
- **`session.meta` arrives while in `error` state.** Stored anyway. A subsequent `resume()` may still find a valid conversation.
- **Storage adapter throws.** Wrapped in try/catch; logged via `onError` with `kind: "session-resume"` (closest match). Persistence failure does not abort the session.
- **`endpoint` ends with `/`.** Normalized internally (single trailing slash stripped).
- **`endpoint` is a relative URL.** Works fine — `fetch` resolves against the current origin. Documented.

## Migration

Soft-breaking nothing. `useAgentStream` continues to work for power users. The new recommended path for app-level setup:

```diff
- const [sessionId, setSessionId] = useState<string | null>(null);
- const [conversationId, setConversationId] = useState<string | null>(null);
- useEffect(() => { /* 80 lines of session creation, persistence, ... */ }, []);
- const { state, status } = useAgentStream({ url: streamUrl, sessionId });
- return (
-   <SessionCtx.Provider value={{ sessionId, conversationId, ... }}>
-     <AgentStateProvider store={...}>
-       <App />
-     </AgentStateProvider>
-   </SessionCtx.Provider>
- );

+ return (
+   <AgentRoot endpoint="/api/agent">
+     <App />
+   </AgentRoot>
+ );
```

Migration doc lives in CHANGELOG with before/after; longer-form doc deferred until consumer demand.

## Open questions

None blocking. Resolved inline:

- **Stream URL convention.** Default `{endpoint}/stream?sessionId={sessionId}`. Path-segment routing is host's job (wrap AgentRoot) until a future ticket adds an override prop.
- **History polling.** No. On-demand `reload()`.
- **Should `<AgentRoot>` own the action POST URL too?** Yes — derived as `{endpoint}/action` (matches the existing `AgentRuntimeProvider` convention). Hosts get `useAgentAction()` automatically without setting up `AgentActionProvider`.

## Versioning

Ships as part of the in-progress 0.5.0 release.
