# Stream Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native `EventSource` with a fetch-based SSE transport. Add three opt-in configs to `useAgentStream`: `retry` (backoff+jitter), `buffer` (bounded queue + overflow strategies), `auth` (token-refresh + Last-Event-ID). Targets v0.7.0.

**Architecture:** Decompose into three pure-function modules (`stream-backoff.ts`, `stream-buffer.ts`, `sse-transport.ts`) plus the orchestrator rewrite of `use-agent-stream.ts`. Each module is independently testable; the orchestrator owns the state machine.

**Tech Stack:** TypeScript strict, React 18/19, native `fetch` ReadableStream, no external SSE library.

**Reference spec:** `docs/superpowers/specs/2026-05-19-stream-resilience-design.md`

---

## File Structure

```
packages/react/src/
├── stream-backoff.ts          # NEW — computeBackoff(attempt, opts, rng)
├── stream-buffer.ts           # NEW — createBuffer(opts) → { enqueue, drain, waitForCapacity, clear }
├── sse-transport.ts           # NEW — connectSse(opts) → Promise<void>
├── use-agent-stream.ts        # REWRITE — orchestrates transport + retry + buffer + auth
└── index.ts                   # MODIFY — re-export config types

packages/react/test/
├── stream-backoff.test.ts
├── stream-buffer.test.ts
├── sse-transport.test.ts
└── use-agent-stream-resilience.test.ts
```

The existing `use-agent-stream.ts` is rewritten in place. Its public return shape stays the same (`{ state, status, close, reset, dispatch, store }`); only the `status` type widens and three new option fields appear.

Tests already exist for the old hook behavior — those are reviewed and kept if still applicable, replaced otherwise.

---

## Task 0: Widen `StreamStatus` enum

**Files:**
- Modify: `packages/react/src/use-agent-stream.ts` (just the type, not the implementation yet)

This task is intentionally scope-limited: only the type widens. The implementation will be replaced wholesale in later tasks. We do this first so that consumers' switch statements break early if `--noFallthroughCasesInSwitch` is on, which surfaces migration work upfront in the diff.

- [ ] **Step 1: Open `packages/react/src/use-agent-stream.ts` and locate the StreamStatus type**

Current:

```ts
export type StreamStatus = "idle" | "connecting" | "open" | "closed" | "error";
```

- [ ] **Step 2: Widen it**

Replace with:

```ts
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
```

- [ ] **Step 3: Verify build + typecheck**

```
pnpm typecheck
```

Expected: PASS. Some existing tests / consumers may exhaustively switch on the old set — if any internal file errors, note them in the report and stop. (For known consumer files, the new members just need a default branch.)

- [ ] **Step 4: Commit**

```
git add packages/react/src/use-agent-stream.ts
git commit -m "feat(react): widen StreamStatus with reauthenticating + reconnecting"
```

---

## Task 1: `computeBackoff` pure function

**Files:**
- Create: `packages/react/src/stream-backoff.ts`
- Create: `packages/react/test/stream-backoff.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/react/test/stream-backoff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeBackoff, type BackoffOptions } from "../src/stream-backoff.js";

const base: BackoffOptions = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: "none",
};

describe("computeBackoff", () => {
  it("doubles per attempt with jitter=none", () => {
    expect(computeBackoff(0, base, () => 0.5)).toBe(500);
    expect(computeBackoff(1, base, () => 0.5)).toBe(1000);
    expect(computeBackoff(2, base, () => 0.5)).toBe(2000);
    expect(computeBackoff(3, base, () => 0.5)).toBe(4000);
  });

  it("caps at maxDelayMs", () => {
    expect(computeBackoff(20, base, () => 0.5)).toBe(30_000);
    expect(computeBackoff(100, base, () => 0.5)).toBe(30_000);
  });

  it("jitter=full → random(0, raw)", () => {
    const opts = { ...base, jitter: "full" as const };
    expect(computeBackoff(0, opts, () => 0)).toBe(0);
    expect(computeBackoff(0, opts, () => 0.5)).toBe(250);
    expect(computeBackoff(0, opts, () => 1)).toBe(500);
  });

  it("jitter=equal → raw/2 + random(0, raw/2)", () => {
    const opts = { ...base, jitter: "equal" as const };
    expect(computeBackoff(0, opts, () => 0)).toBe(250);   // 250 + 0
    expect(computeBackoff(0, opts, () => 1)).toBe(500);   // 250 + 250
    expect(computeBackoff(1, opts, () => 0.5)).toBe(750); // 500 + 250
  });

  it("defaults: rng defaults to Math.random", () => {
    const v = computeBackoff(0, { ...base, jitter: "full" });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/stream-backoff.test.ts
```

- [ ] **Step 3: Implement `packages/react/src/stream-backoff.ts`**

```ts
export interface BackoffOptions {
  initialDelayMs: number;
  maxDelayMs: number;
  jitter: "none" | "full" | "equal";
}

/**
 * Pure exponential backoff with jitter. `attempt` is 0-indexed. `rng` is
 * injectable for tests; defaults to `Math.random`.
 */
export function computeBackoff(
  attempt: number,
  opts: BackoffOptions,
  rng: () => number = Math.random,
): number {
  const raw = Math.min(opts.initialDelayMs * Math.pow(2, attempt), opts.maxDelayMs);
  switch (opts.jitter) {
    case "none":
      return raw;
    case "full":
      return Math.floor(raw * rng());
    case "equal":
      return Math.floor(raw / 2 + (raw / 2) * rng());
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/stream-backoff.test.ts
```

- [ ] **Step 5: Verify typecheck**

```
pnpm typecheck
```

- [ ] **Step 6: Commit**

```
git add packages/react/src/stream-backoff.ts packages/react/test/stream-backoff.test.ts
git commit -m "feat(react): computeBackoff with full/equal/none jitter"
```

---

## Task 2: `createBuffer` bounded queue

**Files:**
- Create: `packages/react/src/stream-buffer.ts`
- Create: `packages/react/test/stream-buffer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/react/test/stream-buffer.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createBuffer } from "../src/stream-buffer.js";

describe("createBuffer", () => {
  it("enqueues up to max, drains in order", () => {
    const buf = createBuffer<number>({ max: 3, onOverflow: "drop-newest" });
    buf.enqueue(1);
    buf.enqueue(2);
    buf.enqueue(3);
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([1, 2, 3]);
  });

  it("drop-oldest drops the head when full", () => {
    const dropped: number[] = [];
    const buf = createBuffer<number>({
      max: 3,
      onOverflow: "drop-oldest",
      onOverflowCallback: (v) => dropped.push(v),
    });
    for (let i = 1; i <= 5; i++) buf.enqueue(i);
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([3, 4, 5]);
    expect(dropped).toEqual([1, 2]);
  });

  it("drop-newest drops the incoming event", () => {
    const dropped: number[] = [];
    const buf = createBuffer<number>({
      max: 3,
      onOverflow: "drop-newest",
      onOverflowCallback: (v) => dropped.push(v),
    });
    for (let i = 1; i <= 5; i++) buf.enqueue(i);
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([1, 2, 3]);
    expect(dropped).toEqual([4, 5]);
  });

  it("callback strategy = drop-newest with required callback", () => {
    const dropped: number[] = [];
    const buf = createBuffer<number>({
      max: 2,
      onOverflow: "callback",
      onOverflowCallback: (v) => dropped.push(v),
    });
    buf.enqueue(1);
    buf.enqueue(2);
    buf.enqueue(3); // dropped
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([1, 2]);
    expect(dropped).toEqual([3]);
  });

  it("block-stream returns a pending promise from waitForCapacity when full", async () => {
    const buf = createBuffer<number>({ max: 2, onOverflow: "block-stream" });
    buf.enqueue(1);
    buf.enqueue(2);

    let resolved = false;
    const wait = buf.waitForCapacity().then(() => {
      resolved = true;
    });
    // Microtask flush — wait should still be pending
    await Promise.resolve();
    expect(resolved).toBe(false);

    buf.drain(() => {});
    await wait;
    expect(resolved).toBe(true);
  });

  it("waitForCapacity resolves immediately when there is room", async () => {
    const buf = createBuffer<number>({ max: 2, onOverflow: "block-stream" });
    buf.enqueue(1);
    await expect(buf.waitForCapacity()).resolves.toBeUndefined();
  });

  it("clear empties the queue", () => {
    const buf = createBuffer<number>({ max: 10, onOverflow: "drop-newest" });
    buf.enqueue(1);
    buf.enqueue(2);
    buf.clear();
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([]);
  });

  it("max=Infinity means unbounded (no overflow ever)", () => {
    const cb = vi.fn();
    const buf = createBuffer<number>({
      max: Infinity,
      onOverflow: "drop-newest",
      onOverflowCallback: cb,
    });
    for (let i = 0; i < 10_000; i++) buf.enqueue(i);
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/stream-buffer.test.ts
```

- [ ] **Step 3: Implement `packages/react/src/stream-buffer.ts`**

```ts
export type OverflowStrategy = "drop-oldest" | "drop-newest" | "block-stream" | "callback";

export interface BufferOptions<T> {
  max: number;
  onOverflow: OverflowStrategy;
  onOverflowCallback?: (dropped: T) => void;
}

export interface Buffer<T> {
  enqueue(value: T): void;
  drain(dispatch: (value: T) => void): void;
  /**
   * For `block-stream`: returns a promise that resolves when the buffer has
   * capacity for at least one more enqueue. For other strategies: resolves
   * immediately (no blocking semantics).
   */
  waitForCapacity(): Promise<void>;
  clear(): void;
}

export function createBuffer<T>(opts: BufferOptions<T>): Buffer<T> {
  const queue: T[] = [];
  const waiters: Array<() => void> = [];

  function notifyWaiters() {
    while (waiters.length > 0 && queue.length < opts.max) {
      const w = waiters.shift();
      w?.();
    }
  }

  return {
    enqueue(value) {
      if (queue.length < opts.max) {
        queue.push(value);
        return;
      }
      switch (opts.onOverflow) {
        case "drop-oldest": {
          const evicted = queue.shift() as T;
          queue.push(value);
          opts.onOverflowCallback?.(evicted);
          return;
        }
        case "drop-newest":
        case "callback": {
          opts.onOverflowCallback?.(value);
          return;
        }
        case "block-stream": {
          // Caller must waitForCapacity() before enqueue under this strategy;
          // if they didn't, we drop newest as a safety net.
          opts.onOverflowCallback?.(value);
          return;
        }
      }
    },

    drain(dispatch) {
      while (queue.length > 0) {
        const value = queue.shift() as T;
        dispatch(value);
      }
      notifyWaiters();
    },

    waitForCapacity() {
      if (opts.onOverflow !== "block-stream") return Promise.resolve();
      if (queue.length < opts.max) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },

    clear() {
      queue.length = 0;
      notifyWaiters();
    },
  };
}
```

- [ ] **Step 4: Run tests — expect PASS (8)**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/stream-buffer.test.ts
```

- [ ] **Step 5: Verify typecheck**

```
pnpm typecheck
```

- [ ] **Step 6: Commit**

```
git add packages/react/src/stream-buffer.ts packages/react/test/stream-buffer.test.ts
git commit -m "feat(react): createBuffer with drop-oldest/drop-newest/block-stream/callback strategies"
```

---

## Task 3: `connectSse` fetch-based transport

**Files:**
- Create: `packages/react/src/sse-transport.ts`
- Create: `packages/react/test/sse-transport.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/react/test/sse-transport.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectSse, SseHttpError } from "../src/sse-transport.js";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(streamFromText(body), { status, headers });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("connectSse", () => {
  it("parses a single data event", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(`data: hello\n\n`));
    const events: Array<{ raw: string; id: string | undefined }> = [];
    const onOpen = vi.fn();
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: (raw, id) => events.push({ raw, id }),
      onOpen,
      onError: () => {},
    });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(events).toEqual([{ raw: "hello", id: undefined }]);
  });

  it("captures id field", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(`id: abc\ndata: foo\n\n`));
    const events: Array<{ raw: string; id: string | undefined }> = [];
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: (raw, id) => events.push({ raw, id }),
      onOpen: () => {},
      onError: () => {},
    });
    expect(events).toEqual([{ raw: "foo", id: "abc" }]);
  });

  it("ignores comments and heartbeats", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(`:keepalive\ndata: x\n\n`));
    const events: Array<{ raw: string }> = [];
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: (raw) => events.push({ raw }),
      onOpen: () => {},
      onError: () => {},
    });
    expect(events).toEqual([{ raw: "x" }]);
  });

  it("joins multi-line data with newlines", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(`data: line1\ndata: line2\n\n`));
    const events: string[] = [];
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: (raw) => events.push(raw),
      onOpen: () => {},
      onError: () => {},
    });
    expect(events).toEqual(["line1\nline2"]);
  });

  it("emits SseHttpError on non-2xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    let err: Error | null = null;
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: () => {},
      onOpen: () => {},
      onError: (e) => { err = e; },
    });
    expect(err).toBeInstanceOf(SseHttpError);
    expect((err as unknown as SseHttpError).status).toBe(401);
  });

  it("forwards headers and lastEventId", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(``));
    globalThis.fetch = fetchSpy;
    await connectSse({
      url: "x",
      headers: { Authorization: "Bearer t" },
      lastEventId: "evt-9",
      signal: new AbortController().signal,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer t");
    expect(headers["Last-Event-ID"]).toBe("evt-9");
    expect(headers["Accept"]).toBe("text/event-stream");
  });

  it("respects abort signal", async () => {
    const ctrl = new AbortController();
    globalThis.fetch = vi.fn().mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const p = connectSse({
      url: "x",
      signal: ctrl.signal,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    ctrl.abort();
    await expect(p).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/sse-transport.test.ts
```

- [ ] **Step 3: Implement `packages/react/src/sse-transport.ts`**

```ts
export class SseHttpError extends Error {
  constructor(public readonly status: number, public readonly statusText: string) {
    super(`SSE HTTP ${status}: ${statusText}`);
    this.name = "SseHttpError";
  }
}

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
 * Connect to an SSE endpoint via fetch. Reads the response body as a stream,
 * parses SSE frames (RFC-ish), and dispatches each `data:` payload to `onEvent`.
 * Resolves when the stream ends, errors, or the signal aborts.
 */
export async function connectSse(opts: SseTransportOptions): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    ...(opts.headers ?? {}),
  };
  if (opts.lastEventId !== undefined) {
    headers["Last-Event-ID"] = opts.lastEventId;
  }

  let response: Response;
  try {
    response = await fetch(opts.url, { headers, signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    opts.onError(err as Error);
    return;
  }

  if (!response.ok) {
    opts.onError(new SseHttpError(response.status, response.statusText));
    return;
  }

  if (!response.body) {
    opts.onError(new Error("SSE response has no body"));
    return;
  }

  opts.onOpen();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let currentId: string | undefined;

  function flushEvent() {
    if (dataLines.length === 0) {
      dataLines = [];
      return;
    }
    const raw = dataLines.join("\n");
    dataLines = [];
    opts.onEvent(raw, currentId);
  }

  function processLine(line: string) {
    if (line === "") {
      flushEvent();
      return;
    }
    if (line.startsWith(":")) return; // comment / heartbeat
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? "" : line.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        dataLines.push(value);
        break;
      case "id":
        currentId = value;
        break;
      case "event":
      case "retry":
        // ignored — we control retry, and we don't differentiate event types here
        break;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        processLine(line);
      }
    }
    // Flush any trailing line
    if (buffer.length > 0) {
      processLine(buffer);
      buffer = "";
    }
    flushEvent();
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    opts.onError(err as Error);
  }
}
```

- [ ] **Step 4: Run tests — expect PASS (7)**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/sse-transport.test.ts
```

- [ ] **Step 5: Verify typecheck + build**

```
pnpm typecheck
pnpm --filter @kibadist/agentui-react build
```

- [ ] **Step 6: Commit**

```
git add packages/react/src/sse-transport.ts packages/react/test/sse-transport.test.ts
git commit -m "feat(react): fetch-based SSE transport with header + Last-Event-ID support"
```

---

## Task 4: Rewrite `useAgentStream` orchestrator

**Files:**
- Modify: `packages/react/src/use-agent-stream.ts` (major rewrite)
- Create: `packages/react/test/use-agent-stream-resilience.test.ts`

This task ties together backoff, buffer, transport, and the new state machine. It's the largest task. If implementation runs into design ambiguity, escalate as BLOCKED — don't improvise the state machine.

- [ ] **Step 1: Write integration tests in `packages/react/test/use-agent-stream-resilience.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentStream } from "../src/use-agent-stream.js";
import * as sseModule from "../src/sse-transport.js";

type ConnectOpts = Parameters<typeof sseModule.connectSse>[0];

let connectSpy: ReturnType<typeof vi.spyOn>;
let connectCalls: ConnectOpts[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  connectCalls = [];
  connectSpy = vi.spyOn(sseModule, "connectSse").mockImplementation(async (opts) => {
    connectCalls.push(opts);
    // Default: never resolves until aborted.
    return new Promise<void>((resolve) => {
      opts.signal.addEventListener("abort", () => resolve());
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  connectSpy.mockRestore();
});

describe("useAgentStream — retry", () => {
  it("retries with backoff after transient failures", async () => {
    let attempts = 0;
    connectSpy.mockImplementation(async (opts) => {
      attempts++;
      if (attempts < 3) {
        opts.onError(new Error("transient"));
        return;
      }
      opts.onOpen();
      // hang until aborted
      await new Promise<void>((r) => opts.signal.addEventListener("abort", () => r()));
    });

    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://x",
        sessionId: "s",
        retry: { maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 1000, jitter: "none" },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(attempts).toBe(1);
    expect(result.current.status).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(attempts).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(attempts).toBe(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("open");
  });

  it("gives up after maxAttempts and stays in error", async () => {
    const onGiveUp = vi.fn();
    connectSpy.mockImplementation(async (opts) => {
      opts.onError(new Error("permanent"));
    });

    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://x",
        sessionId: "s",
        retry: { maxAttempts: 2, initialDelayMs: 50, maxDelayMs: 100, jitter: "none", onGiveUp },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(onGiveUp).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("error");
  });
});

describe("useAgentStream — auth", () => {
  it("refreshes token on 401 and reconnects", async () => {
    const getToken = vi.fn().mockResolvedValueOnce("t1").mockResolvedValueOnce("t2");
    const onUnauthorized = vi.fn().mockResolvedValue(undefined);

    let call = 0;
    connectSpy.mockImplementation(async (opts) => {
      call++;
      if (call === 1) {
        opts.onError(new sseModule.SseHttpError(401, "Unauthorized"));
        return;
      }
      opts.onOpen();
      await new Promise<void>((r) => opts.signal.addEventListener("abort", () => r()));
    });

    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://x",
        sessionId: "s",
        retry: { maxAttempts: 5, initialDelayMs: 0, maxDelayMs: 0, jitter: "none" },
        auth: { getToken, onUnauthorized },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(connectCalls[0].headers?.Authorization).toBe("Bearer t1");
    expect(connectCalls[1].headers?.Authorization).toBe("Bearer t2");
    expect(result.current.status).toBe("open");
  });
});

describe("useAgentStream — buffer", () => {
  it("drop-oldest keeps the most recent events", async () => {
    connectSpy.mockImplementation(async (opts) => {
      opts.onOpen();
      for (let i = 0; i < 50; i++) {
        opts.onEvent(
          JSON.stringify({
            v: 1,
            id: `e-${i}`,
            ts: new Date().toISOString(),
            sessionId: "s",
            op: "ui.append",
            node: { key: `n-${i}`, type: "text-block", props: { text: `${i}` } },
          }),
          `e-${i}`,
        );
      }
      await new Promise<void>((r) => opts.signal.addEventListener("abort", () => r()));
    });

    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://x",
        sessionId: "s",
        buffer: { max: 10, onOverflow: "drop-oldest" },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(result.current.state.nodes.length).toBe(10);
    expect(result.current.state.nodes.at(-1)?.key).toBe("n-49");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/use-agent-stream-resilience.test.ts
```

- [ ] **Step 3: Replace `packages/react/src/use-agent-stream.ts`**

```ts
"use client";

import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from "react";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { safeParseAgentEvent } from "@kibadist/agentui-validate";
import { createAgentStore, type AgentStore } from "./store.js";
import type { AgentState } from "./reducer.js";
import { connectSse, SseHttpError } from "./sse-transport.js";
import { computeBackoff, type BackoffOptions } from "./stream-backoff.js";
import { createBuffer, type OverflowStrategy } from "./stream-buffer.js";

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

export interface UseAgentStreamResult {
  state: AgentState;
  status: StreamStatus;
  close: () => void;
  reset: () => void;
  dispatch: (event: AgentWireEvent) => void;
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

export function useAgentStream(options: UseAgentStreamOptions): UseAgentStreamResult {
  const { url, sessionId, onEvent, onInvalidEvent, enabled = true, retry, buffer, auth } = options;

  const storeRef = useRef<AgentStore | null>(null);
  if (storeRef.current === null) storeRef.current = createAgentStore();
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [status, setStatus] = useState<StreamStatus>("idle");

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onInvalidRef = useRef(onInvalidEvent);
  onInvalidRef.current = onInvalidEvent;
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

        await connectSse({
          url: sseUrl,
          headers,
          lastEventId,
          signal: ctrl.signal,
          onOpen: () => {
            attempt = 0;
            setStatus("open");
          },
          onEvent: (raw, id) => {
            if (id !== undefined) lastEventId = id;
            let parsedRaw: unknown;
            try {
              parsedRaw = JSON.parse(raw);
            } catch {
              return;
            }
            const result = safeParseAgentEvent(parsedRaw);
            if (result.ok) {
              ingest(result.value);
            } else {
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
          // After refresh, retry immediately (no backoff for auth-driven reconnect)
          continue;
        }

        if (connectionError === null) {
          // Stream ended normally — treat as closed
          setStatus("closed");
          return;
        }

        if (await advanceOrGiveUp(connectionError)) return;
      }
    }

    async function advanceOrGiveUp(err: Error): Promise<boolean> {
      attempt++;
      if (attempt >= maxAttempts) {
        retryRef.current?.onGiveUp?.(err);
        setStatus("error");
        return true;
      }
      setStatus("reconnecting");
      const delay = computeBackoff(attempt - 1, backoffOpts);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay);
        ctrl.signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        }, { once: true });
      });
      return cancelled;
    }

    attemptConnect();

    return () => {
      cancelled = true;
      ctrl.abort();
      abortRef.current = null;
      setStatus("closed");
    };
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
```

- [ ] **Step 4: Run new resilience tests — expect PASS**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/use-agent-stream-resilience.test.ts
```

- [ ] **Step 5: Run the FULL react suite — confirm no regression**

```
pnpm --filter @kibadist/agentui-react exec vitest run
```

If any pre-existing test breaks because it depended on `EventSource` (e.g., a test using `vi.spyOn(globalThis, "EventSource")`), that test must be updated. Look for spied/mocked `EventSource` in `packages/react/test/**` and adapt — those should be deleted or rewritten to spy on `connectSse` instead.

- [ ] **Step 6: Verify typecheck + monorepo tests**

```
pnpm typecheck
pnpm test
```

- [ ] **Step 7: Commit**

```
git add packages/react/src/use-agent-stream.ts packages/react/test/use-agent-stream-resilience.test.ts
git commit -m "feat(react): useAgentStream — retry/backoff, backpressure, auth-aware reconnect"
```

If pre-existing tests had to be deleted or rewritten, include those files in the same commit and mention in the message.

---

## Task 5: Re-export config types + barrel update

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Add the new config types to the barrel**

Find the existing `useAgentStream` export block (search for `useAgentStream`) and add the new option types alongside it:

```ts
export { useAgentStream } from "./use-agent-stream.js";
export type {
  UseAgentStreamOptions,
  UseAgentStreamResult,
  StreamStatus,
  RetryConfig,
  BufferConfig,
  AuthConfig,
} from "./use-agent-stream.js";
```

If the existing export already lists some of these, just add the missing ones.

- [ ] **Step 2: Verify build/typecheck**

```
pnpm --filter @kibadist/agentui-react build
pnpm typecheck
```

- [ ] **Step 3: Run full test suite**

```
pnpm test
```

- [ ] **Step 4: Commit**

```
git add packages/react/src/index.ts
git commit -m "feat(react): export RetryConfig, BufferConfig, AuthConfig types"
```

---

## Task 6: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Add `## 0.7.0` block to CHANGELOG.md above `## 0.6.4`**

```markdown
## 0.7.0

### Added
- `useAgentStream` now supports three opt-in configs: `retry` (max attempts + exponential backoff with jitter), `buffer` (bounded event queue with drop-oldest/drop-newest/block-stream/callback overflow strategies), and `auth` (token-refresh hook + `Last-Event-ID` resume on reconnect).
- New `StreamStatus` values: `reauthenticating` (waiting for `auth.getToken()` / `auth.onUnauthorized()`) and `reconnecting` (sleeping the backoff delay between attempts).

### Changed
- The SSE transport now uses `fetch` + `ReadableStream` instead of the native `EventSource`. Behavior is observably the same for consumers who don't supply any of the new configs (still retries forever, no buffer cap). Browsers and Node ≥18 are supported; the Edge runtime works in Next.js App Router.

### Migration
- Hosts that exhaustively switch on `StreamStatus` need a default branch for the two new members. TypeScript with `--noFallthroughCasesInSwitch` will flag this.
- Servers SHOULD include an `id:` line on each SSE event and SHOULD replay buffered events on reconnect when `Last-Event-ID` is sent. Without these, the client still works — there's just no event resumption.
```

- [ ] **Step 2: Add a "Stream resilience" subsection to README.md**

Find the existing `useAgentStream` documentation or the most recent feature subsection. Add immediately after:

```markdown
### Stream resilience

Opt-in retry, backpressure, and auth-aware reconnect:

```ts
const { state, status } = useAgentStream({
  url, sessionId,
  retry: { maxAttempts: 5, initialDelayMs: 500, maxDelayMs: 30_000, jitter: "full" },
  buffer: { max: 1000, onOverflow: "drop-oldest" },
  auth: {
    getToken: () => fetchToken(),
    onUnauthorized: () => refreshSession(),
  },
});
```

`status` widens to `"idle" | "connecting" | "open" | "reauthenticating" | "reconnecting" | "closed" | "error"`. With no configs, defaults preserve previous behavior (infinite retry, unbounded buffer, no auth header).

Server-side: include an `id:` line on each event so `Last-Event-ID` reconnects can resume; return HTTP 401 to trigger `auth.onUnauthorized` + `auth.getToken`.
```

When pasting into README.md, use real triple-backticks (the inner block in this plan is shown without escaping for readability).

- [ ] **Step 3: Verify everything**

```
pnpm typecheck && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 4: Commit**

```
git add CHANGELOG.md README.md
git commit -m "docs(react): CHANGELOG 0.7.0 + README stream resilience section"
```

---

## Self-Review Notes

Coverage vs spec:
- §2 Transport rewrite → Task 3
- §3 Expanded StreamStatus → Task 0 (type), Task 4 (usage)
- §4 Retry/backoff → Task 1 (helper), Task 4 (orchestrator)
- §5 Backpressure → Task 2 (buffer module), Task 4 (integration)
- §6 Auth-aware reconnect → Task 4
- §7 Hook surface → Task 4 + Task 5 (re-exports)
- §8 File layout → matches
- §9 Tests → distributed
- §10 Server-side contract → Task 6 (documented in README)
- §11 Out of scope → no tasks (intentional)

Identifier consistency:
- `connectSse`, `SseHttpError` — Task 3
- `computeBackoff`, `BackoffOptions` — Task 1
- `createBuffer`, `BufferOptions`, `OverflowStrategy` — Task 2
- `RetryConfig`, `BufferConfig`, `AuthConfig`, `StreamStatus`, `UseAgentStreamOptions`, `UseAgentStreamResult` — Task 4 + Task 5
- Drainage mechanic: `requestAnimationFrame` (with `setTimeout(_,0)` fallback) — Task 4

Known risks (engineer should be aware):
- **Pre-existing tests that mock `EventSource` will break.** Task 4 calls this out; the engineer must search for `EventSource` mocks in `packages/react/test/**` and either delete or rewrite them.
- **The buffer-drain pattern with `requestAnimationFrame` inside the hook effect is the only piece using rAF directly.** If the existing `<AgentDevTools />` recorder uses a similar pattern, no conflict (different stores).
- **The state machine in `useAgentStream` is the trickiest piece.** If implementation is unsure between two valid behaviors at a transition, the implementer should report DONE_WITH_CONCERNS and surface both options rather than choose silently.
