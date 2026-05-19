---
ticket: DET-154
title: "@kibadist/agentui-node — server companion package"
version_target: 0.9.0 (initial publish at current monorepo version, 0.3.1)
date: 2026-05-19
---

# `@kibadist/agentui-node` — Design Spec

## 1. Goal

Today every server consumer hand-rolls (a) the SSE wire format and (b) conversation persistence. Ship a framework-agnostic server companion so the platform story is symmetric:
- **Client:** `@kibadist/agentui-react`
- **Server:** `@kibadist/agentui-node`

The existing `@kibadist/agentui-nest` keeps shipping — it stays as the Nest-flavored bus (RxJS Subjects, DI). The new `agentui-node` package is the lower-level, dependency-free primitive that Nest, Fastify, Express, Hono, or raw `http` can plug into.

## 2. Package layout

```
packages/node/
  package.json              # name: @kibadist/agentui-node, no peer deps
  tsconfig.json
  src/
    index.ts                # public exports
    sse-writer.ts           # createAgentStream + AgentStream (Node ServerResponse)
    sse-readable.ts         # createAgentReadable (Web ReadableStream)
    conversation.ts         # Conversation class + ConversationStorage interface
    storage/
      memory.ts             # MemoryConversationStorage
    helpers/
      text-stream.ts        # emitTextStream (wraps reasoning.start/delta/end)
      tool-call.ts          # emitToolCall (wraps tool.start/result/cancel)
    types.ts                # EmitInput, hook types
  test/
    sse-writer.test.ts
    sse-readable.test.ts
    sse-backpressure.test.ts
    conversation.test.ts
    helpers.test.ts
    types.test-d.ts         # type-only: invalid event shape rejected
```

Dependencies: `@kibadist/agentui-protocol` only (workspace dep). No runtime peer deps; works on Node ≥ 18.

## 3. SSE writer (Node)

```ts
export interface AgentStreamOptions {
  /** Required; included in every emitted event */
  sessionId: string;
  /** Optional; correlates events across turns */
  traceId?: string;
  /** Initial connection headers; defaults applied automatically */
  headers?: Record<string, string>;
  /** Fired after each event is written to the wire */
  onEventEmitted?: (event: AgentWireEvent) => void;
  /** If provided, every emitted event is also forwarded here */
  conversation?: Conversation;
}

export interface AgentStream {
  /** Emit an AgentWireEvent. Auto-fills v/id/ts/sessionId. */
  emit(event: EmitInput): Promise<void>;
  /** Convenience for plain text into reasoning stream */
  comment(text: string): Promise<void>;
  /** Close the connection (flushes any pending writes) */
  close(): Promise<void>;
  /** True once close() resolves OR client disconnects */
  readonly closed: boolean;
}

export function createAgentStream(
  res: NodeServerResponse,
  opts: AgentStreamOptions,
): AgentStream;
```

`NodeServerResponse` is a structural type matching `http.ServerResponse`: `writeHead`, `write`, `end`, `on`, `destroyed`.

### 3.1 Wire format

Each emitted event is framed as:
```
id: <event.id>\n
data: <JSON.stringify(event)>\n
\n
```

(Matches `text/event-stream` per WHATWG. JSON has no embedded raw newlines, so a single `data:` line per event is correct.)

Heartbeats: `:\n\n` (SSE comment) sent every 15s as an optional configurable interval — defaults ON to keep proxies from idle-closing. Disable via `heartbeatMs: 0`.

### 3.2 Headers

Set on first `emit()` (or first `comment`/`close`):
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Caller-supplied `opts.headers` merges last (caller wins).

### 3.3 Backpressure

`emit` is `async`. Internal flow:
1. Build `chunk = "id: <id>\ndata: <json>\n\n"`.
2. If `res.write(chunk)` returns `true` → resolve immediately.
3. If `false` → await `'drain'` event before resolving.

If `res.destroyed` mid-emit, `close()` is set and the emit promise resolves (silently drops — no throw). Hooks still fire so the conversation persistence can record the event.

## 4. SSE writer (Web)

```ts
export interface AgentReadable {
  readable: ReadableStream<Uint8Array>;
  stream: AgentStream;
}
export function createAgentReadable(opts: AgentStreamOptions): AgentReadable;
```

For Hono on Workers/edge, Bun, or Next.js Route Handlers. Same `AgentStream` surface; `closed` flips when the consumer cancels the readable.

## 5. Typed `emit` input

```ts
import type { AgentWireEvent } from "@kibadist/agentui-protocol";

/** Required fields the caller provides; library fills v/id/ts/sessionId. */
export type EmitInput =
  | OmitBase<UIAppendEvent>
  | OmitBase<UIReplacePropsEvent>
  | OmitBase<UIReplacePatchEvent>
  | OmitBase<UIRemoveEvent>
  | OmitBase<UIToastEvent>
  | OmitBase<UINavigateEvent>
  | OmitBase<UIResetEvent>
  | OmitBase<ToolStartEvent>
  | OmitBase<ToolArgsDeltaEvent>
  | OmitBase<ToolResultEvent>
  | OmitBase<ToolCancelEvent>
  | OmitBase<ReasoningStartEvent>
  | OmitBase<ReasoningDeltaEvent>
  | OmitBase<ReasoningEndEvent>
  | OmitBase<OptimisticApplyEvent>
  | OmitBase<OptimisticConfirmEvent>
  | OmitBase<OptimisticRollbackEvent>
  | OmitBase<SessionMetaEvent>
  | OmitBase<SessionInitEvent>;

type OmitBase<T> = Omit<T, "v" | "id" | "ts" | "sessionId"> & {
  /** Optional override; library generates if omitted */
  id?: string;
  /** Optional override; library generates if omitted */
  ts?: string;
  /** Optional override; defaults to stream's traceId */
  traceId?: string;
};
```

Compile-time guarantee: passing `{ op: "unknown" }` is a type error.

## 6. Conversation persistence

```ts
export type StoredEvent = AgentWireEvent | ActionEvent;

export interface ConversationStorage {
  append(sessionId: string, event: StoredEvent): Promise<void>;
  history(
    sessionId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<StoredEvent[]>;
}

export interface ConversationOptions {
  storage: ConversationStorage;
  onConversationAppended?: (sessionId: string, event: StoredEvent) => void;
}

export class Conversation {
  constructor(opts: ConversationOptions);
  append(sessionId: string, event: StoredEvent): Promise<void>;
  history(sessionId: string, opts?: { limit?: number; before?: string }): Promise<StoredEvent[]>;
}
```

When an `AgentStream` is constructed with `conversation: conv`, each `emit` triggers `conv.append(sessionId, event)` AFTER the wire write succeeds. ActionEvents the consumer receives go through `conv.append` directly (the package doesn't see them — the consumer does).

### 6.1 In-memory adapter (ships)

```ts
export class MemoryConversationStorage implements ConversationStorage {
  // Map<sessionId, StoredEvent[]>
  append(sessionId, event): Promise<void>;
  history(sessionId, opts): Promise<StoredEvent[]>;
}
```

`history()` returns chronological (insertion) order. `before` filters by event `ts` (events with `ts < before` only). `limit` caps result.

### 6.2 Prisma / Drizzle adapters (NOT in v0.9)

Ticket lists Prisma & Drizzle "reference adapters." Scope reduction for v0.9:
- Interface + memory adapter only.
- README documents the `ConversationStorage` shape and shows a 12-line Prisma adapter example consumers can paste.
- Reasoning: shipping Prisma/Drizzle imports drags in peer-dep surface that won't satisfy real users anyway (every consumer has their own schema). The interface is the contract; example code is the migration path.

## 7. Hooks

Three named hooks, all optional:
- `onSessionCreated(sessionId)` — caller-driven; we don't manage sessions in this package. Documented as a recommended pattern: consumer calls `onSessionCreated?.(sessionId)` themselves in their session-create endpoint.
- `onEventEmitted(event)` — fires on `AgentStream.emit` after wire write.
- `onConversationAppended(sessionId, event)` — fires on `Conversation.append` after storage write.

(The first one is documented but not enforced by the library; it's a callback shape the consumer wires up.)

## 8. Helpers

### 8.1 `emitTextStream`

```ts
export interface EmitTextStreamOptions {
  reasoningId?: string;            // default: crypto.randomUUID()
  chunks: AsyncIterable<string>;
}
export async function emitTextStream(
  stream: AgentStream,
  opts: EmitTextStreamOptions,
): Promise<string>; // returns the reasoningId
```

Emits `reasoning.start`, one `reasoning.delta` per chunk, then `reasoning.end`. If the iterable throws, emits `reasoning.end` with whatever was accumulated; the error propagates.

### 8.2 `emitToolCall`

```ts
export interface EmitToolCallOptions<R> {
  toolId?: string;                 // default: crypto.randomUUID()
  name: string;
  args: unknown;
  runner: () => Promise<R>;
}
export async function emitToolCall<R>(
  stream: AgentStream,
  opts: EmitToolCallOptions<R>,
): Promise<R>;
```

Lifecycle:
1. emit `tool.start` with `{ id: toolId, name, args }`
2. `await runner()`
3. emit `tool.result` with `{ id: toolId, status: "ok", result }` and return the result
4. If runner throws: emit `tool.result` with `{ id: toolId, status: "error", error: { message: err.message } }` and re-throw.

(`tool.cancel` is reserved for user-initiated cancellation, not runner failure.)

## 9. Tests

### 9.1 SSE wire format (`sse-writer.test.ts`)
- Construct a mock `ServerResponse` that buffers writes.
- Create stream with `sessionId: "s1"`.
- `await stream.emit({ op: "ui.append", node: { key: "k", type: "x.y", props: {} } })`
- Assert chunk matches `/^id: [a-f0-9-]+\ndata: \{.*"op":"ui.append".*\}\n\n$/`.
- Parse the data line, confirm `v === 1`, `sessionId === "s1"`, `ts` is ISO-8601, `id` is a UUID.
- Emit 10 events; assert 10 frames, each separated by blank line.
- Assert headers were written on first emit: `Content-Type: text/event-stream`.

### 9.2 Backpressure (`sse-backpressure.test.ts`)
- Mock response where `write()` returns `false` first call, then emits `'drain'` async; subsequent calls return `true`.
- `await Promise.all([stream.emit(a), stream.emit(b)])`; assert both resolve and order preserved (FIFO).

### 9.3 Web readable (`sse-readable.test.ts`)
- `const { readable, stream } = createAgentReadable({ sessionId: "s1" })`.
- Pipe `readable` through a `TextDecoder`; collect chunks.
- Emit 3 events; close; assert decoded text contains 3 frames.

### 9.4 Conversation (`conversation.test.ts`)
- `MemoryConversationStorage`: append 5 events, `history()` returns them in order.
- `before: ts` filter excludes events at or after `ts`.
- `limit: 3` caps the result; returns first 3 by insertion order.
- Hook: `onConversationAppended` fires once per append, in order.

### 9.5 Helpers (`helpers.test.ts`)
- `emitTextStream`: pass async generator yielding `["hello", " ", "world"]`; assert 3 `reasoning.delta` events between `reasoning.start` and `reasoning.end`.
- `emitToolCall` happy: runner resolves `42`, assert `tool.start` then `tool.result` with `status: "ok"`, `result: 42`; function returns `42`.
- `emitToolCall` error: runner throws `Error("boom")`, assert `tool.start` then `tool.result` with `status: "error"`, `error.message: "boom"`; function re-throws.

### 9.6 Type tests (`types.test-d.ts`)
- `stream.emit({ op: "unknown" })` → `expectTypeOf<typeof emit>().parameter(0).not.toMatchTypeOf<{op: "unknown"}>()`.
- `stream.emit({ op: "ui.append" })` missing `node` is a type error.

## 10. Public exports (`index.ts`)

```ts
export { createAgentStream } from "./sse-writer.js";
export { createAgentReadable } from "./sse-readable.js";
export { Conversation } from "./conversation.js";
export { MemoryConversationStorage } from "./storage/memory.js";
export { emitTextStream } from "./helpers/text-stream.js";
export { emitToolCall } from "./helpers/tool-call.js";

export type {
  AgentStream,
  AgentStreamOptions,
  AgentReadable,
  EmitInput,
} from "./types.js";
export type {
  ConversationStorage,
  ConversationOptions,
  StoredEvent,
} from "./conversation.js";
```

No re-exports of protocol types (consumers import those from `@kibadist/agentui-protocol`).

## 11. Out of scope (deferred)

- Prisma/Drizzle adapters (documented in README; not shipped).
- Built-in session manager (consumer holds sessionId; existing `@kibadist/agentui-nest` provides one with RxJS).
- Migration script from `@kibadist/agentui-nest` to `@kibadist/agentui-node`.
- Server-side action receiver/router (the consumer's HTTP layer handles inbound actions; we provide the storage hook only).

## 12. Acceptance criteria

- `pnpm test` passes (new tests pass; no regressions).
- `pnpm typecheck` clean.
- `pnpm build` produces `packages/node/dist/`.
- New package is workspace-resolvable: `import { createAgentStream } from "@kibadist/agentui-node"`.
- README has a new "Server companion (agentui-node)" subsection with at least: minimal Node HTTP example, conversation persistence example, Prisma adapter sketch.
- CHANGELOG records the addition.
- `scripts/bump-and-publish.sh` includes `packages/node` in dependency order (after protocol, no internal deps beyond protocol).
- Existing `@kibadist/agentui-nest` continues to publish and work unchanged.
