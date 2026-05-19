# `@kibadist/agentui-node` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a framework-agnostic Node.js server companion package — typed SSE writer, conversation persistence interface with in-memory adapter, hooks, and high-level helpers (`emitTextStream`, `emitToolCall`).

**Architecture:** New workspace package `@kibadist/agentui-node` at `packages/node/`. Zero runtime peer deps. Imports `@kibadist/agentui-protocol` for event types. Two transport adapters share the same `AgentStream` surface: `createAgentStream(res, opts)` for Node `ServerResponse`-shaped writers, `createAgentReadable(opts)` for Web `ReadableStream<Uint8Array>` (Hono, edge).

**Tech Stack:** TypeScript strict (ES2022), pnpm workspace, ESM-only with `.js` import extensions, Vitest, no external runtime dependencies.

---

### Task 1: Scaffold package

**Files:**
- Create: `packages/node/package.json`
- Create: `packages/node/tsconfig.json`
- Create: `packages/node/src/index.ts` (empty placeholder export)
- Modify: `scripts/bump-and-publish.sh` — add `packages/node` to `PACKAGES` array (after `packages/protocol`, before `packages/validate` — protocol is the only internal dep)

- [ ] **Step 1: Create `packages/node/package.json`**

```json
{
  "name": "@kibadist/agentui-node",
  "version": "0.3.1",
  "description": "Framework-agnostic AgentUI server companion: SSE writer, typed emitter, conversation persistence",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/kibadist/agentui.git",
    "directory": "packages/node"
  },
  "homepage": "https://github.com/kibadist/agentui#readme",
  "publishConfig": {
    "access": "public"
  },
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "prepublishOnly": "pnpm run build",
    "build": "tsc",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@kibadist/agentui-protocol": "workspace:^"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Create `packages/node/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/node/src/index.ts`**

```ts
// Public API — populated by later tasks.
export {};
```

- [ ] **Step 4: Add to publish script**

Open `scripts/bump-and-publish.sh`, find the `PACKAGES=(` block, and add `  packages/node` between `packages/protocol` and `packages/validate`. Final block:

```bash
PACKAGES=(
  packages/protocol
  packages/node
  packages/validate
  packages/llm
  packages/react
  packages/nest
  packages/openai
  packages/ai
  packages/next
  packages/cli
)
```

- [ ] **Step 5: Install + verify**

Run: `pnpm install && pnpm --filter @kibadist/agentui-node typecheck && pnpm --filter @kibadist/agentui-node build`
Expected: clean typecheck, `packages/node/dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add packages/node scripts/bump-and-publish.sh pnpm-lock.yaml
git commit -m "feat(node): scaffold @kibadist/agentui-node package (DET-154)"
```

---

### Task 2: Shared types

**Files:**
- Create: `packages/node/src/types.ts`

- [ ] **Step 1: Write the types module**

```ts
import type {
  AgentWireEvent,
  UIAppendEvent,
  UIReplacePropsEvent,
  UIReplacePatchEvent,
  UIRemoveEvent,
  UIToastEvent,
  UINavigateEvent,
  UIResetEvent,
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ToolCallResultEvent,
  ToolCallCancelEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  OptimisticApplyEvent,
  OptimisticConfirmEvent,
  OptimisticRollbackEvent,
  SessionMetaEvent,
  SessionInitEvent,
} from "@kibadist/agentui-protocol";

/**
 * Per-event input shape: caller provides everything except v/id/ts/sessionId
 * which the stream fills in. id/ts/traceId remain overridable.
 */
type OmitBase<T> = Omit<T, "v" | "id" | "ts" | "sessionId"> & {
  id?: string;
  ts?: string;
  traceId?: string;
};

export type EmitInput =
  | OmitBase<UIAppendEvent>
  | OmitBase<UIReplacePropsEvent>
  | OmitBase<UIReplacePatchEvent>
  | OmitBase<UIRemoveEvent>
  | OmitBase<UIToastEvent>
  | OmitBase<UINavigateEvent>
  | OmitBase<UIResetEvent>
  | OmitBase<ToolCallStartEvent>
  | OmitBase<ToolArgsDeltaEvent>
  | OmitBase<ToolCallResultEvent>
  | OmitBase<ToolCallCancelEvent>
  | OmitBase<ReasoningStartEvent>
  | OmitBase<ReasoningDeltaEvent>
  | OmitBase<ReasoningEndEvent>
  | OmitBase<OptimisticApplyEvent>
  | OmitBase<OptimisticConfirmEvent>
  | OmitBase<OptimisticRollbackEvent>
  | OmitBase<SessionMetaEvent>
  | OmitBase<SessionInitEvent>;

export interface AgentStream {
  /** Emit an event. Resolves once the wire has accepted (or buffered) the frame. */
  emit(event: EmitInput): Promise<void>;
  /** Send an SSE comment line (`: <text>\n\n`). Useful as a manual heartbeat. */
  comment(text: string): Promise<void>;
  /** Close the underlying transport. Idempotent. */
  close(): Promise<void>;
  /** True once close() has been called OR the consumer disconnected. */
  readonly closed: boolean;
}

export interface AgentStreamOptions {
  /** Required; stamped onto every emitted event. */
  sessionId: string;
  /** Optional; default traceId stamped on events (overridable per emit). */
  traceId?: string;
  /** Headers merged onto the SSE response. Caller wins on conflict. */
  headers?: Record<string, string>;
  /** Heartbeat interval in ms (0 to disable). Default 15000. */
  heartbeatMs?: number;
  /** Fires after each event is written to the wire. */
  onEventEmitted?: (event: AgentWireEvent) => void;
  /** If set, each emitted event is also forwarded to conversation.append. */
  conversation?: import("./conversation.js").Conversation;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @kibadist/agentui-node typecheck`
Expected: clean (conversation.js does not yet exist but TypeScript `import("./...")` in a type position is lazy — should resolve via stub created in Task 5; if it errors, defer this step until then. If it errors NOW, comment out the `conversation` field temporarily and uncomment in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add packages/node/src/types.ts
git commit -m "feat(node): EmitInput + AgentStream types (DET-154)"
```

---

### Task 3: SSE writer (Node ServerResponse)

**Files:**
- Create: `packages/node/src/sse-writer.ts`
- Modify: `packages/node/src/index.ts` (re-export)
- Test: `packages/node/test/sse-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { createAgentStream } from "../src/sse-writer.js";

interface MockRes {
  headers: Record<string, string>;
  status: number;
  chunks: string[];
  ended: boolean;
  destroyed: boolean;
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: string): boolean;
  end(): void;
  on(event: string, cb: () => void): void;
}

function makeRes(): MockRes {
  return {
    headers: {},
    status: 0,
    chunks: [],
    ended: false,
    destroyed: false,
    writeHead(s, h) {
      this.status = s;
      this.headers = { ...h };
    },
    write(c) {
      this.chunks.push(c);
      return true;
    },
    end() {
      this.ended = true;
    },
    on() {},
  };
}

describe("createAgentStream — wire format", () => {
  it("writes headers on first emit and frames the event correctly", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });

    await stream.emit({
      op: "ui.append",
      node: { key: "k1", type: "x.y", props: {} },
    });

    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.headers["Cache-Control"]).toBe("no-cache, no-transform");
    expect(res.headers["Connection"]).toBe("keep-alive");

    expect(res.chunks).toHaveLength(1);
    const frame = res.chunks[0];
    expect(frame).toMatch(/^id: [0-9a-f-]{36}\ndata: \{.*\}\n\n$/);

    const dataLine = frame.split("\n")[1];
    const payload = JSON.parse(dataLine.slice("data: ".length));
    expect(payload.v).toBe(1);
    expect(payload.op).toBe("ui.append");
    expect(payload.sessionId).toBe("s1");
    expect(typeof payload.ts).toBe("string");
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.node).toEqual({ key: "k1", type: "x.y", props: {} });
  });

  it("emits 10 events as 10 frames", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    for (let i = 0; i < 10; i++) {
      await stream.emit({
        op: "ui.append",
        node: { key: `k${i}`, type: "x.y", props: { i } },
      });
    }
    expect(res.chunks).toHaveLength(10);
    expect(res.chunks.every((c) => c.endsWith("\n\n"))).toBe(true);
  });

  it("respects caller-supplied id/ts overrides", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    await stream.emit({
      op: "ui.toast",
      id: "fixed-id",
      ts: "2026-05-19T00:00:00.000Z",
      level: "info",
      message: "hello",
    });
    const payload = JSON.parse(res.chunks[0].split("\n")[1].slice(6));
    expect(payload.id).toBe("fixed-id");
    expect(payload.ts).toBe("2026-05-19T00:00:00.000Z");
  });

  it("close() ends the response and sets closed=true", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    await stream.close();
    expect(res.ended).toBe(true);
    expect(stream.closed).toBe(true);
  });

  it("onEventEmitted hook fires per event", async () => {
    const res = makeRes();
    const hook = vi.fn();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
      onEventEmitted: hook,
    });
    await stream.emit({ op: "ui.toast", level: "info", message: "x" });
    await stream.emit({ op: "ui.toast", level: "info", message: "y" });
    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook.mock.calls[0][0].op).toBe("ui.toast");
    expect(hook.mock.calls[1][0].message).toBe("y");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kibadist/agentui-node test`
Expected: FAIL — `createAgentStream` not implemented.

- [ ] **Step 3: Write the implementation**

```ts
import { randomUUID } from "node:crypto";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import type { AgentStream, AgentStreamOptions, EmitInput } from "./types.js";

/**
 * Structural subset of node:http ServerResponse — works with Express, Fastify .raw, raw http.
 */
export interface NodeServerResponse {
  writeHead(statusCode: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  end(): unknown;
  on(event: "drain" | "close" | "error", listener: () => void): unknown;
  readonly destroyed?: boolean;
}

const DEFAULT_HEARTBEAT_MS = 15_000;

const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function createAgentStream(
  res: NodeServerResponse,
  opts: AgentStreamOptions,
): AgentStream {
  let headersWritten = false;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const onClientClose = () => {
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  res.on("close", onClientClose);
  res.on("error", onClientClose);

  function ensureHeaders() {
    if (headersWritten) return;
    headersWritten = true;
    const merged: Record<string, string> = { ...BASE_HEADERS, ...(opts.headers ?? {}) };
    res.writeHead(200, merged);
    const ms = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    if (ms > 0) {
      heartbeat = setInterval(() => {
        if (!closed) {
          res.write(":\n\n");
        }
      }, ms);
      // Don't keep the event loop alive solely for the heartbeat.
      (heartbeat as unknown as { unref?: () => void }).unref?.();
    }
  }

  async function writeChunk(chunk: string): Promise<void> {
    if (closed || res.destroyed) {
      closed = true;
      return;
    }
    const ok = res.write(chunk);
    if (ok) return;
    await new Promise<void>((resolve) => {
      res.on("drain", resolve);
    });
  }

  function buildFrame(event: AgentWireEvent): string {
    return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  function finalize(input: EmitInput): AgentWireEvent {
    const full = {
      v: 1 as const,
      id: input.id ?? randomUUID(),
      ts: input.ts ?? new Date().toISOString(),
      sessionId: opts.sessionId,
      ...(input.traceId !== undefined
        ? { traceId: input.traceId }
        : opts.traceId !== undefined
          ? { traceId: opts.traceId }
          : {}),
      ...input,
    } as AgentWireEvent;
    // Re-stamp authoritative fields in case `input` smuggled in a sessionId.
    (full as { sessionId: string }).sessionId = opts.sessionId;
    (full as { v: 1 }).v = 1;
    return full;
  }

  return {
    async emit(input) {
      ensureHeaders();
      const event = finalize(input);
      await writeChunk(buildFrame(event));
      opts.onEventEmitted?.(event);
      if (opts.conversation) {
        await opts.conversation.append(opts.sessionId, event);
      }
    },
    async comment(text) {
      ensureHeaders();
      const safe = text.replace(/\n/g, " ");
      await writeChunk(`: ${safe}\n\n`);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (!res.destroyed) {
        res.end();
      }
    },
    get closed() {
      return closed;
    },
  };
}
```

- [ ] **Step 4: Add export to index.ts**

Replace `packages/node/src/index.ts`:

```ts
export { createAgentStream } from "./sse-writer.js";
export type {
  NodeServerResponse,
} from "./sse-writer.js";
export type {
  AgentStream,
  AgentStreamOptions,
  EmitInput,
} from "./types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @kibadist/agentui-node test`
Expected: PASS for the 5 test cases.

- [ ] **Step 6: Typecheck and build**

Run: `pnpm --filter @kibadist/agentui-node typecheck && pnpm --filter @kibadist/agentui-node build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/node/src/sse-writer.ts packages/node/src/index.ts packages/node/test/sse-writer.test.ts
git commit -m "feat(node): SSE writer with typed emit + onEventEmitted hook (DET-154)"
```

---

### Task 4: Backpressure handling

**Files:**
- Test: `packages/node/test/sse-backpressure.test.ts`

(No code change — Task 3 already wired `await drain`. This task adds explicit test coverage.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createAgentStream } from "../src/sse-writer.js";

describe("createAgentStream — backpressure", () => {
  it("awaits 'drain' when write returns false; preserves FIFO", async () => {
    const drainListeners: Array<() => void> = [];
    let writeCount = 0;
    const res = {
      writeHead: () => {},
      write(_chunk: string) {
        writeCount++;
        // Pretend the first event hits a full buffer; subsequent writes succeed.
        return writeCount > 1;
      },
      end: () => {},
      on(event: string, cb: () => void) {
        if (event === "drain") drainListeners.push(cb);
      },
      destroyed: false,
    };

    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });

    const order: string[] = [];
    const p1 = stream.emit({ op: "ui.toast", level: "info", message: "a" }).then(() => order.push("a"));
    const p2 = stream.emit({ op: "ui.toast", level: "info", message: "b" }).then(() => order.push("b"));

    // p1 is parked on drain — release it.
    await Promise.resolve(); // let microtasks run
    await Promise.resolve();
    expect(drainListeners.length).toBeGreaterThan(0);
    drainListeners.forEach((cb) => cb());

    await Promise.all([p1, p2]);
    expect(order).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @kibadist/agentui-node test`
Expected: PASS (Task 3's `await drain` logic should already satisfy this).

- [ ] **Step 3: Commit**

```bash
git add packages/node/test/sse-backpressure.test.ts
git commit -m "test(node): SSE writer respects write() backpressure (DET-154)"
```

---

### Task 5: Conversation persistence

**Files:**
- Create: `packages/node/src/conversation.ts`
- Create: `packages/node/src/storage/memory.ts`
- Modify: `packages/node/src/index.ts`
- Test: `packages/node/test/conversation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { Conversation, MemoryConversationStorage } from "../src/index.js";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";

function makeEvent(i: number, ts: string): AgentWireEvent {
  return {
    v: 1,
    id: `e${i}`,
    ts,
    sessionId: "s1",
    op: "ui.toast",
    level: "info",
    message: `m${i}`,
  };
}

describe("Conversation + MemoryConversationStorage", () => {
  it("append + history returns events in chronological order", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    for (let i = 0; i < 5; i++) {
      await conv.append("s1", makeEvent(i, `2026-05-19T00:00:0${i}.000Z`));
    }
    const hist = await conv.history("s1");
    expect(hist).toHaveLength(5);
    expect(hist.map((e) => (e as { id: string }).id)).toEqual(["e0", "e1", "e2", "e3", "e4"]);
  });

  it("limit caps result", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    for (let i = 0; i < 5; i++) {
      await conv.append("s1", makeEvent(i, `2026-05-19T00:00:0${i}.000Z`));
    }
    const hist = await conv.history("s1", { limit: 3 });
    expect(hist).toHaveLength(3);
    expect(hist.map((e) => (e as { id: string }).id)).toEqual(["e0", "e1", "e2"]);
  });

  it("before filters events with ts >= before", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    for (let i = 0; i < 5; i++) {
      await conv.append("s1", makeEvent(i, `2026-05-19T00:00:0${i}.000Z`));
    }
    const hist = await conv.history("s1", { before: "2026-05-19T00:00:03.000Z" });
    expect(hist.map((e) => (e as { id: string }).id)).toEqual(["e0", "e1", "e2"]);
  });

  it("history is empty for unknown session", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    expect(await conv.history("nope")).toEqual([]);
  });

  it("onConversationAppended fires once per append in order", async () => {
    const hook = vi.fn();
    const conv = new Conversation({
      storage: new MemoryConversationStorage(),
      onConversationAppended: hook,
    });
    await conv.append("s1", makeEvent(0, "2026-05-19T00:00:00.000Z"));
    await conv.append("s1", makeEvent(1, "2026-05-19T00:00:01.000Z"));
    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook.mock.calls[0][0]).toBe("s1");
    expect((hook.mock.calls[0][1] as { id: string }).id).toBe("e0");
    expect((hook.mock.calls[1][1] as { id: string }).id).toBe("e1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kibadist/agentui-node test`
Expected: FAIL — `Conversation` and `MemoryConversationStorage` not exported.

- [ ] **Step 3: Write `conversation.ts`**

```ts
import type { AgentWireEvent } from "@kibadist/agentui-protocol";

export type StoredEvent = AgentWireEvent | (AgentWireEvent extends infer T ? T : never);

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
  private readonly storage: ConversationStorage;
  private readonly onAppend?: (sessionId: string, event: StoredEvent) => void;

  constructor(opts: ConversationOptions) {
    this.storage = opts.storage;
    this.onAppend = opts.onConversationAppended;
  }

  async append(sessionId: string, event: StoredEvent): Promise<void> {
    await this.storage.append(sessionId, event);
    this.onAppend?.(sessionId, event);
  }

  history(
    sessionId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<StoredEvent[]> {
    return this.storage.history(sessionId, opts);
  }
}
```

NOTE: change the `StoredEvent` type to also accept ActionEvents:

```ts
import type { AgentWireEvent, ActionEvent } from "@kibadist/agentui-protocol";

export type StoredEvent = AgentWireEvent | ActionEvent;
```

(Replace the placeholder `StoredEvent` definition with this two-line form.)

- [ ] **Step 4: Write `storage/memory.ts`**

```ts
import type { ConversationStorage, StoredEvent } from "../conversation.js";

export class MemoryConversationStorage implements ConversationStorage {
  private readonly store = new Map<string, StoredEvent[]>();

  async append(sessionId: string, event: StoredEvent): Promise<void> {
    const list = this.store.get(sessionId);
    if (list) {
      list.push(event);
    } else {
      this.store.set(sessionId, [event]);
    }
  }

  async history(
    sessionId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<StoredEvent[]> {
    const list = this.store.get(sessionId);
    if (!list) return [];
    let result: StoredEvent[] = list;
    if (opts?.before) {
      const cutoff = opts.before;
      result = result.filter((e) => e.ts < cutoff);
    }
    if (opts?.limit !== undefined) {
      result = result.slice(0, opts.limit);
    }
    return result.slice();
  }
}
```

- [ ] **Step 5: Update `index.ts`**

Append to `packages/node/src/index.ts`:

```ts
export { Conversation } from "./conversation.js";
export type {
  ConversationStorage,
  ConversationOptions,
  StoredEvent,
} from "./conversation.js";
export { MemoryConversationStorage } from "./storage/memory.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @kibadist/agentui-node test`
Expected: PASS (5 conversation tests + previous tests).

- [ ] **Step 7: Wire `AgentStream` to use Conversation**

The `emit` body in `sse-writer.ts` already calls `opts.conversation?.append(...)`. Add a test confirming this:

Append to `packages/node/test/sse-writer.test.ts` inside the existing `describe`:

```ts
  it("forwards emitted events to attached Conversation", async () => {
    const conv = new (await import("../src/index.js")).Conversation({
      storage: new (await import("../src/index.js")).MemoryConversationStorage(),
    });
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
      conversation: conv,
    });
    await stream.emit({ op: "ui.toast", level: "info", message: "x" });
    await stream.emit({ op: "ui.toast", level: "info", message: "y" });
    const hist = await conv.history("s1");
    expect(hist).toHaveLength(2);
  });
```

Run: `pnpm --filter @kibadist/agentui-node test` — expect PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/node/src/conversation.ts packages/node/src/storage packages/node/src/index.ts packages/node/test/conversation.test.ts packages/node/test/sse-writer.test.ts
git commit -m "feat(node): Conversation + MemoryConversationStorage + stream integration (DET-154)"
```

---

### Task 6: Web ReadableStream variant

**Files:**
- Create: `packages/node/src/sse-readable.ts`
- Modify: `packages/node/src/index.ts`
- Test: `packages/node/test/sse-readable.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createAgentReadable } from "../src/sse-readable.js";

describe("createAgentReadable", () => {
  it("returns a ReadableStream that emits framed events", async () => {
    const { readable, stream } = createAgentReadable({
      sessionId: "s1",
      heartbeatMs: 0,
    });

    const decoder = new TextDecoder();
    const reader = readable.getReader();
    const collected: string[] = [];

    const collect = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        collected.push(decoder.decode(value, { stream: true }));
      }
    })();

    await stream.emit({ op: "ui.toast", level: "info", message: "a" });
    await stream.emit({ op: "ui.toast", level: "info", message: "b" });
    await stream.emit({ op: "ui.toast", level: "info", message: "c" });
    await stream.close();
    await collect;

    const joined = collected.join("");
    const frames = joined.split("\n\n").filter(Boolean);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatch(/^id: [0-9a-f-]+\ndata: \{.*"message":"a".*\}$/);
  });

  it("closed flips when the consumer cancels the readable", async () => {
    const { readable, stream } = createAgentReadable({
      sessionId: "s1",
      heartbeatMs: 0,
    });
    const reader = readable.getReader();
    await reader.cancel();
    // Best-effort: emit after cancel becomes a no-op and resolves.
    await stream.emit({ op: "ui.toast", level: "info", message: "ignored" });
    expect(stream.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kibadist/agentui-node test`
Expected: FAIL — `createAgentReadable` not implemented.

- [ ] **Step 3: Write `sse-readable.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import type { AgentStream, AgentStreamOptions, EmitInput } from "./types.js";

export interface AgentReadable {
  readable: ReadableStream<Uint8Array>;
  stream: AgentStream;
}

const DEFAULT_HEARTBEAT_MS = 15_000;

export function createAgentReadable(opts: AgentStreamOptions): AgentReadable {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  function stopHeartbeat() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      const ms = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
      if (ms > 0) {
        heartbeat = setInterval(() => {
          if (!closed) {
            try {
              controller.enqueue(encoder.encode(":\n\n"));
            } catch {
              closed = true;
              stopHeartbeat();
            }
          }
        }, ms);
        (heartbeat as unknown as { unref?: () => void }).unref?.();
      }
    },
    cancel() {
      closed = true;
      stopHeartbeat();
    },
  });

  function finalize(input: EmitInput): AgentWireEvent {
    const full = {
      v: 1 as const,
      id: input.id ?? randomUUID(),
      ts: input.ts ?? new Date().toISOString(),
      sessionId: opts.sessionId,
      ...(input.traceId !== undefined
        ? { traceId: input.traceId }
        : opts.traceId !== undefined
          ? { traceId: opts.traceId }
          : {}),
      ...input,
    } as AgentWireEvent;
    (full as { sessionId: string }).sessionId = opts.sessionId;
    (full as { v: 1 }).v = 1;
    return full;
  }

  function writeFrame(chunk: string) {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      closed = true;
      stopHeartbeat();
    }
  }

  const stream: AgentStream = {
    async emit(input) {
      if (closed) return;
      const event = finalize(input);
      writeFrame(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
      opts.onEventEmitted?.(event);
      if (opts.conversation) {
        await opts.conversation.append(opts.sessionId, event);
      }
    },
    async comment(text) {
      if (closed) return;
      writeFrame(`: ${text.replace(/\n/g, " ")}\n\n`);
    },
    async close() {
      if (closed) return;
      closed = true;
      stopHeartbeat();
      try {
        controller.close();
      } catch {
        // Already closed
      }
    },
    get closed() {
      return closed;
    },
  };

  return { readable, stream };
}
```

- [ ] **Step 4: Update `index.ts`**

Append:

```ts
export { createAgentReadable } from "./sse-readable.js";
export type { AgentReadable } from "./sse-readable.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @kibadist/agentui-node test`
Expected: PASS for the 2 readable tests.

- [ ] **Step 6: Commit**

```bash
git add packages/node/src/sse-readable.ts packages/node/src/index.ts packages/node/test/sse-readable.test.ts
git commit -m "feat(node): createAgentReadable (Web ReadableStream variant) (DET-154)"
```

---

### Task 7: Helpers — `emitTextStream` and `emitToolCall`

**Files:**
- Create: `packages/node/src/helpers/text-stream.ts`
- Create: `packages/node/src/helpers/tool-call.ts`
- Modify: `packages/node/src/index.ts`
- Test: `packages/node/test/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { createAgentStream, emitTextStream, emitToolCall } from "../src/index.js";

function makeRes() {
  return {
    headers: {} as Record<string, string>,
    chunks: [] as string[],
    writeHead(_s: number, h: Record<string, string>) {
      this.headers = h;
    },
    write(c: string) {
      this.chunks.push(c);
      return true;
    },
    end() {},
    on() {},
    destroyed: false,
  };
}

function payloads(chunks: string[]) {
  return chunks.map((c) => JSON.parse(c.split("\n")[1].slice("data: ".length)));
}

describe("emitTextStream", () => {
  it("emits start/delta*/end for an async iterable", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    async function* gen() {
      yield "hello";
      yield " ";
      yield "world";
    }
    const reasoningId = await emitTextStream(stream, { chunks: gen() });
    expect(typeof reasoningId).toBe("string");
    const ops = payloads(res.chunks).map((p) => p.op);
    expect(ops).toEqual(["reasoning.start", "reasoning.delta", "reasoning.delta", "reasoning.delta", "reasoning.end"]);
    expect(payloads(res.chunks).every((p) => p.id === reasoningId)).toBe(true);
    expect(payloads(res.chunks)[2].delta).toBe(" ");
  });

  it("emits reasoning.end even if iterable throws, then re-throws", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    async function* gen() {
      yield "a";
      throw new Error("boom");
    }
    await expect(emitTextStream(stream, { chunks: gen() })).rejects.toThrow("boom");
    const ops = payloads(res.chunks).map((p) => p.op);
    expect(ops).toEqual(["reasoning.start", "reasoning.delta", "reasoning.end"]);
  });
});

describe("emitToolCall", () => {
  it("happy path: emits tool.start + tool.result(ok) and returns runner result", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    const result = await emitToolCall(stream, {
      name: "search",
      args: { q: "foo" },
      runner: async () => 42,
    });
    expect(result).toBe(42);
    const events = payloads(res.chunks);
    expect(events.map((e) => e.op)).toEqual(["tool.start", "tool.result"]);
    expect(events[0].name).toBe("search");
    expect(events[0].args).toEqual({ q: "foo" });
    expect(events[1].status).toBe("ok");
    expect(events[1].result).toBe(42);
    expect(events[0].id).toBe(events[1].id);
  });

  it("error path: emits tool.start + tool.result(error) and re-throws", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    await expect(
      emitToolCall(stream, {
        name: "broken",
        args: {},
        runner: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    const events = payloads(res.chunks);
    expect(events.map((e) => e.op)).toEqual(["tool.start", "tool.result"]);
    expect(events[1].status).toBe("error");
    expect(events[1].error.message).toBe("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kibadist/agentui-node test`
Expected: FAIL — helpers not implemented.

- [ ] **Step 3: Write `helpers/text-stream.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { AgentStream } from "../types.js";

export interface EmitTextStreamOptions {
  /** Optional reasoning-segment id; auto-generated if omitted. */
  reasoningId?: string;
  /** Source of text chunks. Each chunk becomes one reasoning.delta. */
  chunks: AsyncIterable<string>;
}

export async function emitTextStream(
  stream: AgentStream,
  opts: EmitTextStreamOptions,
): Promise<string> {
  const id = opts.reasoningId ?? randomUUID();
  await stream.emit({ op: "reasoning.start", id });
  try {
    for await (const delta of opts.chunks) {
      await stream.emit({ op: "reasoning.delta", id, delta });
    }
    await stream.emit({ op: "reasoning.end", id });
    return id;
  } catch (err) {
    await stream.emit({ op: "reasoning.end", id });
    throw err;
  }
}
```

- [ ] **Step 4: Write `helpers/tool-call.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { AgentStream } from "../types.js";

export interface EmitToolCallOptions<R> {
  /** Optional tool-call id; auto-generated if omitted. */
  toolId?: string;
  /** Tool name (registered on the client). */
  name: string;
  /** Initial args payload. */
  args: unknown;
  /** Async function whose resolved value becomes the tool.result. */
  runner: () => Promise<R>;
}

export async function emitToolCall<R>(
  stream: AgentStream,
  opts: EmitToolCallOptions<R>,
): Promise<R> {
  const id = opts.toolId ?? randomUUID();
  await stream.emit({ op: "tool.start", id, name: opts.name, args: opts.args });
  const t0 = Date.now();
  try {
    const result = await opts.runner();
    await stream.emit({
      op: "tool.result",
      id,
      status: "ok",
      result,
      durationMs: Date.now() - t0,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stream.emit({
      op: "tool.result",
      id,
      status: "error",
      error: { message },
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}
```

- [ ] **Step 5: Update `index.ts`**

Append:

```ts
export { emitTextStream } from "./helpers/text-stream.js";
export type { EmitTextStreamOptions } from "./helpers/text-stream.js";
export { emitToolCall } from "./helpers/tool-call.js";
export type { EmitToolCallOptions } from "./helpers/tool-call.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @kibadist/agentui-node test`
Expected: PASS (4 helper tests).

- [ ] **Step 7: Commit**

```bash
git add packages/node/src/helpers packages/node/src/index.ts packages/node/test/helpers.test.ts
git commit -m "feat(node): emitTextStream + emitToolCall helpers (DET-154)"
```

---

### Task 8: Type-only tests (compile-time safety)

**Files:**
- Create: `packages/node/test/types.test-d.ts`

- [ ] **Step 1: Write the type tests**

```ts
import { expectTypeOf } from "vitest";
import type { EmitInput, AgentStream } from "../src/index.js";

declare const stream: AgentStream;

// Valid: a known op with all required fields.
stream.emit({
  op: "ui.append",
  node: { key: "k", type: "x.y", props: {} },
});

// Invalid: unknown op should be rejected.
// @ts-expect-error — "unknown" is not in the AgentWireEvent op union.
stream.emit({ op: "unknown" });

// Invalid: ui.append requires `node`.
// @ts-expect-error — missing required `node`.
stream.emit({ op: "ui.append" });

// EmitInput must NOT require v/id/ts/sessionId
expectTypeOf<EmitInput>().not.toHaveProperty("v");

// EmitInput is a union containing at least ui.append shape.
const sample: EmitInput = {
  op: "ui.toast",
  level: "info",
  message: "x",
};
expectTypeOf(sample).toMatchTypeOf<EmitInput>();
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @kibadist/agentui-node test` (vitest also runs `.test-d.ts` via configured typecheck) and `pnpm --filter @kibadist/agentui-node typecheck`.
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add packages/node/test/types.test-d.ts
git commit -m "test(node): type-only checks for EmitInput safety (DET-154)"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Append README section**

Add a new subsection (place it after the existing server-related docs, before any client recap). Use fenced code blocks; keep the example minimal.

````markdown
### Server companion — `@kibadist/agentui-node`

Framework-agnostic server primitives. Drop in alongside Express, Fastify, Hono, raw `node:http`, or a Next.js Route Handler.

```ts
import { createServer } from "node:http";
import { createAgentStream } from "@kibadist/agentui-node";

createServer(async (req, res) => {
  if (req.url?.endsWith("/stream")) {
    const stream = createAgentStream(res, { sessionId: "demo" });
    await stream.emit({
      op: "ui.append",
      node: { key: "hello", type: "panel", props: { text: "Hi" } },
    });
    await stream.close();
  } else {
    res.statusCode = 404;
    res.end();
  }
}).listen(3001);
```

Built-in helpers wrap the common patterns:

```ts
import { emitToolCall, emitTextStream } from "@kibadist/agentui-node";

await emitToolCall(stream, {
  name: "search_clients",
  args: { q: "Acme" },
  runner: () => db.clients.search("Acme"),
});

await emitTextStream(stream, {
  chunks: anthropicResponse.deltas, // any AsyncIterable<string>
});
```

#### Conversation persistence

```ts
import { Conversation, MemoryConversationStorage } from "@kibadist/agentui-node";

const conv = new Conversation({ storage: new MemoryConversationStorage() });
const stream = createAgentStream(res, { sessionId, conversation: conv });
// Every emitted event is also written to storage.

const history = await conv.history(sessionId, { limit: 50 });
```

To plug in Prisma or Drizzle, implement the `ConversationStorage` interface against your schema — append + history are the only two methods.

#### Web / Edge variant

```ts
import { createAgentReadable } from "@kibadist/agentui-node";

export async function GET() {
  const { readable, stream } = createAgentReadable({ sessionId: "demo" });
  await stream.emit({ op: "ui.toast", level: "info", message: "hi" });
  await stream.close();
  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```
````

- [ ] **Step 2: Update CHANGELOG**

Add a new bullet under the upcoming-release entry (or create a new `## Unreleased` block if there isn't one). Locate the most recent `## [x.y.z]` and add above it:

```markdown
## [Unreleased]

### Added
- `@kibadist/agentui-node` — framework-agnostic server companion. `createAgentStream` (Node `ServerResponse`) and `createAgentReadable` (Web `ReadableStream`), `Conversation` + `MemoryConversationStorage`, hooks (`onEventEmitted`, `onConversationAppended`), helpers (`emitTextStream`, `emitToolCall`). DET-154.
```

If the file already has an `Unreleased` block, add only the bullet under its `### Added` heading.

- [ ] **Step 3: Build, typecheck, full test suite**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: clean across the entire monorepo, no regressions.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: @kibadist/agentui-node server companion (DET-154)"
```
