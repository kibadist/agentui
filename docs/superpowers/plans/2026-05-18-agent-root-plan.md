# AgentRoot Session Lifecycle Implementation Plan (DET-142)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `<AgentRoot>` — a single mount-point that bundles session creation/resume, conversationId persistence (pluggable SessionStorageAdapter), stream wiring (`useAgentStream`), history rehydration (`useAgentHistory`), and error handling. Adds one wire event (`session.meta`) and supporting types (`AgentError`, `SessionStorageAdapter`, `HistoryMessage`).

**Architecture:** AgentRoot owns the session HTTP lifecycle and embeds `useAgentStream` internally. It wraps children in `<SessionContext>` + `<AgentStateProvider>` + `<AgentActionProvider>`. The `session.meta` SSE event is consumed via `useAgentStream().onEvent` for conversationId persistence (no reducer slice needed; `default` no-ops). Hooks `useAgentSession()` and `useAgentHistory()` read from context.

**Tech Stack:** TypeScript strict, React 19, Vitest + jsdom + @testing-library/react. No new runtime deps.

**Spec:** [docs/superpowers/specs/2026-05-18-agent-root-design.md](../specs/2026-05-18-agent-root-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/protocol/src/index.ts` | Modify | Add `SessionMetaEvent`; widen `AgentWireEvent` |
| `packages/validate/src/schemas.ts` | Modify | Add `sessionMetaSchema`; widen `agentWireEventSchema` |
| `packages/validate/src/index.ts` | Modify | Export `sessionMetaSchema` |
| `packages/react/src/agent-error.ts` | Create | `AgentError` interface |
| `packages/react/src/storage-adapter.ts` | Create | `SessionStorageAdapter` + `localStorageAdapter` |
| `packages/react/src/session-context.tsx` | Create | Session context + `useAgentSession` hook |
| `packages/react/src/agent-root.tsx` | Create | `<AgentRoot>` component |
| `packages/react/src/use-agent-history.ts` | Create | `useAgentHistory` hook + `HistoryMessage` type |
| `packages/react/src/reducer.ts` | Modify (type-only) | Widen `AgentAction` to include `SessionMetaEvent` |
| `packages/react/src/index.ts` | Modify | New exports across all the new files |
| `packages/validate/test/session-meta.test.ts` | Create | 2 schema tests |
| `packages/react/test/agent-root.test.tsx` | Create | 5 component tests |
| `packages/react/test/use-agent-history.test.tsx` | Create | 3 hook tests |
| `CHANGELOG.md` | Modify | Extend 0.5.0 |
| `README.md` | Modify | "Quick start with `<AgentRoot>`" subsection |

---

## Conventions

- All commands run from `/Users/max/agentui`.
- Tests: `pnpm test` (one-shot — wired to `vitest run`). NEVER watch mode.
- Typecheck: `pnpm typecheck`.
- After modifying `packages/protocol` or `packages/validate`, build them: `pnpm --filter @kibadist/agentui-protocol build && pnpm --filter @kibadist/agentui-validate build`.
- ESM `.js` relative imports throughout.

---

## Task 1: Protocol + validate — `session.meta` wire event

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/validate/src/schemas.ts`
- Modify: `packages/validate/src/index.ts`
- Create: `packages/validate/test/session-meta.test.ts`
- (Possibly) Modify: `packages/react/src/reducer.ts` (type-only widening of AgentAction)

### Step 1: Write failing tests

Create `packages/validate/test/session-meta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { safeParseAgentEvent } from "../src/index.js";

describe("safeParseAgentEvent — session.meta", () => {
  it("round-trips a valid session.meta with conversationId", () => {
    const raw = {
      v: 1,
      id: "evt-meta-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "session.meta",
      conversationId: "conv-abc",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "session.meta") {
      expect(result.value.conversationId).toBe("conv-abc");
    }
  });

  it("rejects a session.meta missing conversationId", () => {
    const raw = {
      v: 1,
      id: "evt-bad",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "session.meta",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/validate/test/session-meta.test.ts`
Expected: failure — `session.meta` not in the union.

### Step 3: Add `SessionMetaEvent` to `packages/protocol/src/index.ts`

Find this block:

```ts
export type OptimisticEventOp = OptimisticEvent["op"];

/**
 * All wire events the reducer accepts. Most flow server → client (UI patches,
 * tool calls, reasoning), but optimistic events are bidirectional —
 * hosts can dispatch them client-side AND servers can emit them over SSE.
 */
export type AgentWireEvent = UIEvent | ToolEvent | ReasoningEvent | OptimisticEvent;
```

Replace with:

```ts
export type OptimisticEventOp = OptimisticEvent["op"];

// ─── Session Lifecycle Events ───────────────────────────────────────────────

export interface SessionMetaEvent extends BaseEvent {
  op: "session.meta";
  /** Server-issued conversation id, persisted by `<AgentRoot>`. */
  conversationId: string;
}

/**
 * All wire events the reducer accepts. Most flow server → client (UI patches,
 * tool calls, reasoning, session metadata), but optimistic events are
 * bidirectional — hosts can dispatch them client-side AND servers can emit
 * them over SSE.
 */
export type AgentWireEvent =
  | UIEvent
  | ToolEvent
  | ReasoningEvent
  | OptimisticEvent
  | SessionMetaEvent;
```

### Step 4: Build protocol

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-protocol build`
Expected: build succeeds.

### Step 5: Add `sessionMetaSchema` to `packages/validate/src/schemas.ts`

Find the existing `optimisticEventSchema` block:

```ts
export const optimisticEventSchema = z.discriminatedUnion("op", [
  optimisticApplySchema,
  optimisticConfirmSchema,
  optimisticRollbackSchema,
]);
```

AFTER it, BEFORE the existing `agentWireEventSchema`, insert:

```ts

// ─── Session Lifecycle Events ───────────────────────────────────────────────

export const sessionMetaSchema = baseEventSchema.extend({
  op: z.literal("session.meta"),
  conversationId: z.string().min(1).max(256),
});
```

Then find the current `agentWireEventSchema` and add `sessionMetaSchema` as a 17th variant:

```ts
export const agentWireEventSchema = z.discriminatedUnion("op", [
  uiAppendSchema,
  uiReplaceSchema,
  uiRemoveSchema,
  uiToastSchema,
  uiNavigateSchema,
  uiResetSchema,
  toolStartSchema,
  toolArgsDeltaSchema,
  toolResultSchema,
  toolCancelSchema,
  reasoningStartSchema,
  reasoningDeltaSchema,
  reasoningEndSchema,
  optimisticApplySchema,
  optimisticConfirmSchema,
  optimisticRollbackSchema,
  sessionMetaSchema,
]);
```

### Step 6: Export `sessionMetaSchema` from `packages/validate/src/index.ts`

Find:

```ts
export {
  uiNodeSchema,
  uiEventSchema,
  actionEventSchema,
  toolEventSchema,
  reasoningEventSchema,
  optimisticEventSchema,
  agentWireEventSchema,
} from "./schemas.js";
```

Replace with:

```ts
export {
  uiNodeSchema,
  uiEventSchema,
  actionEventSchema,
  toolEventSchema,
  reasoningEventSchema,
  optimisticEventSchema,
  sessionMetaSchema,
  agentWireEventSchema,
} from "./schemas.js";
```

### Step 7: Build validate

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-validate build`
Expected: build succeeds.

### Step 8: Type-fix in `packages/react/src/reducer.ts` (if needed)

Run typecheck: `cd /Users/max/agentui && pnpm typecheck`

If it fails because `parsed.value` (AgentWireEvent now wider) isn't assignable to `AgentAction`, apply this type-only fix:

In `packages/react/src/reducer.ts`, find the top imports and add `SessionMetaEvent`:

```ts
  SessionMetaEvent,
```

(alongside the other event type imports from `@kibadist/agentui-protocol`).

Find:

```ts
export type AgentAction =
  | UIEvent
  | ToolEvent
  | ReasoningEvent
  | OptimisticEvent
  | AgentResetAction;
```

Replace with:

```ts
export type AgentAction =
  | UIEvent
  | ToolEvent
  | ReasoningEvent
  | OptimisticEvent
  | SessionMetaEvent
  | AgentResetAction;
```

The reducer's `default: return state` already handles unknown ops. `<AgentRoot>` listens to session.meta via the stream's `onEvent` callback, not via the reducer.

### Step 9: Typecheck + run new tests

Run: `cd /Users/max/agentui && pnpm typecheck && pnpm test packages/validate/test/session-meta.test.ts`
Expected: typecheck clean; `2 passed`.

### Step 10: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 11: Commit

```bash
cd /Users/max/agentui
git add packages/protocol/src/index.ts packages/validate/src/schemas.ts packages/validate/src/index.ts packages/validate/test/session-meta.test.ts
# Add reducer.ts only if the type-fix was needed
git add packages/react/src/reducer.ts
git commit -m "feat(protocol,validate): add session.meta wire event"
```

(Omit the second `git add` if reducer.ts wasn't modified.)

---

## Task 2: Foundation types — `AgentError` + `SessionStorageAdapter`

**Files:**
- Create: `packages/react/src/agent-error.ts`
- Create: `packages/react/src/storage-adapter.ts`

Two small foundation files. No tests — they're exercised by later tasks. Exported but not yet wired into `index.ts` (Task 6 does that as part of the overall export wave).

### Step 1: Create `packages/react/src/agent-error.ts`

```ts
/**
 * Structured error surfaced by `<AgentRoot>` via `onError`. Discriminated by
 * `kind` so hosts can branch (e.g., show a retry button for `stream` failures
 * but not for `session-create`).
 */
export interface AgentError {
  kind: "session-create" | "session-resume" | "history-fetch" | "stream";
  message: string;
  /** The underlying error (Response, Error, unknown) if available. */
  cause?: unknown;
}
```

### Step 2: Create `packages/react/src/storage-adapter.ts`

```ts
/**
 * Pluggable async/sync storage for persisting conversation ids and other
 * session lifecycle data. The default `localStorageAdapter` is web-only;
 * React Native consumers pass a wrapper around AsyncStorage.
 */
export interface SessionStorageAdapter {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

const hasLocalStorage = (): boolean => {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
};

/** Web default. Safe in SSR — falls back to in-memory no-op when localStorage isn't available. */
export const localStorageAdapter: SessionStorageAdapter = {
  get(key) {
    if (!hasLocalStorage()) return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    if (!hasLocalStorage()) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded / privacy mode — swallow.
    }
  },
  remove(key) {
    if (!hasLocalStorage()) return;
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
```

### Step 3: Typecheck

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck`
Expected: clean.

### Step 4: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/agent-error.ts packages/react/src/storage-adapter.ts
git commit -m "feat(react): add AgentError type + SessionStorageAdapter + localStorageAdapter"
```

---

## Task 3: Session context + `useAgentSession` hook

**Files:**
- Create: `packages/react/src/session-context.tsx`

The session context shape carries everything `useAgentSession()` returns. AgentRoot creates the context value in Task 4. For Task 3, ship just the context plumbing — no tests yet because there's no way to populate the context without AgentRoot. The component tests in Task 4 cover the hook end-to-end.

### Step 1: Create `packages/react/src/session-context.tsx`

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AgentError } from "./agent-error.js";

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

/**
 * Connection config — endpoint + fetch — published by `<AgentRoot>` so hooks
 * like `useAgentHistory` can issue requests without needing those as props.
 */
export interface AgentRootConfig {
  endpoint: string;
  fetch: typeof fetch;
}

const SessionContext = createContext<UseAgentSessionResult | null>(null);
const AgentRootConfigContext = createContext<AgentRootConfig | null>(null);

/**
 * Internal provider used by `<AgentRoot>`. Hosts should not use this directly —
 * mount `<AgentRoot>` instead.
 */
export interface SessionProviderProps {
  value: UseAgentSessionResult;
  config: AgentRootConfig;
  children: ReactNode;
}

export function SessionProvider({ value, config, children }: SessionProviderProps) {
  return (
    <AgentRootConfigContext.Provider value={config}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </AgentRootConfigContext.Provider>
  );
}

/**
 * Subscribe to the current session lifecycle state. Must be used inside an
 * `<AgentRoot>` ancestor.
 *
 * @param id Reserved for multi-agent support (DET-143). Ignored in v0.5.4.
 */
export function useAgentSession(_id?: string): UseAgentSessionResult {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error(
      "[agentui] useAgentSession must be used inside <AgentRoot>. " +
        "Wrap your tree in <AgentRoot endpoint=\"...\">.",
    );
  }
  return value;
}

/**
 * Internal — `useAgentHistory` and similar hooks use this to access the
 * AgentRoot's endpoint and fetch. Throws if no `<AgentRoot>` ancestor.
 */
export function useAgentRootConfig(): AgentRootConfig {
  const value = useContext(AgentRootConfigContext);
  if (value === null) {
    throw new Error(
      "[agentui] useAgentRootConfig must be used inside <AgentRoot>.",
    );
  }
  return value;
}
```

### Step 2: Typecheck

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck`
Expected: clean.

### Step 3: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/session-context.tsx
git commit -m "feat(react): add session context + useAgentSession hook"
```

---

## Task 4: `<AgentRoot>` component + tests

**Files:**
- Create: `packages/react/src/agent-root.tsx`
- Create: `packages/react/test/agent-root.test.tsx`

The biggest task in this plan. Implements the entire session HTTP lifecycle, embeds `useAgentStream`, wires up all three internal contexts. Five tests exercise the full mount → POST → SSE → context propagation flow.

### Step 1: Write the failing tests

Create `packages/react/test/agent-root.test.tsx` with this exact content:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";
import {
  AgentRoot,
  useAgentNodes,
  useAgentSession,
} from "../src/index.js";
import type {
  AgentError,
  SessionStorageAdapter,
  UIAppendEvent,
} from "../src/index.js";

// In-memory storage adapter for tests
function makeStorage(initial: Record<string, string> = {}): SessionStorageAdapter & {
  _store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));
  return {
    _store: store,
    get(key) {
      return store.get(key) ?? null;
    },
    set(key, value) {
      store.set(key, value);
    },
    remove(key) {
      store.delete(key);
    },
  };
}

// MockEventSource — same shape as use-agent-stream.test.tsx
class MockEventSource {
  static instances: MockEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState = MockEventSource.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

function makeFetchMock(handlers: Record<string, (url: string, init?: RequestInit) => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) return handler(url, init);
    }
    return new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  MockEventSource.instances.length = 0;
  // @ts-expect-error — replace global for the test
  globalThis.EventSource = MockEventSource;
  (globalThis.EventSource as unknown as { CLOSED: number }).CLOSED = MockEventSource.CLOSED;
});

afterEach(() => {
  cleanup();
  // @ts-expect-error
  delete globalThis.EventSource;
});

function StatusProbe() {
  const s = useAgentSession();
  return (
    <>
      <span data-testid="status">{s.status}</span>
      <span data-testid="session-id">{s.sessionId ?? ""}</span>
      <span data-testid="conversation-id">{s.conversationId ?? ""}</span>
    </>
  );
}

describe("AgentRoot", () => {
  it("fresh session: mount → POST /session → SSE opens → status connected", async () => {
    const storage = makeStorage();
    const fetchMock = makeFetchMock({
      "/session": () =>
        new Response(JSON.stringify({ sessionId: "ses_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const { getByTestId } = render(
      <AgentRoot endpoint="/api/agent" storage={storage} fetch={fetchMock}>
        <StatusProbe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });
    expect(getByTestId("session-id").textContent).toBe("ses_1");

    // Verify the POST was made WITHOUT a conversationId query param.
    const sessionCalls = fetchMock.mock.calls.filter(([url]) =>
      (typeof url === "string" ? url : url.toString()).includes("/session"),
    );
    expect(sessionCalls.length).toBeGreaterThanOrEqual(1);
    const firstUrl = sessionCalls[0][0] as string;
    expect(firstUrl).toContain("/session");
    expect(firstUrl).not.toContain("conversationId=");
  });

  it("resume: mount with persisted conversationId → POST includes conversationId", async () => {
    const storage = makeStorage({
      "agentui:default:conversationId": "conv_persisted",
    });
    const fetchMock = makeFetchMock({
      "/session": () =>
        new Response(JSON.stringify({ sessionId: "ses_resumed" }), { status: 200 }),
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    });

    const { getByTestId } = render(
      <AgentRoot endpoint="/api/agent" storage={storage} fetch={fetchMock}>
        <StatusProbe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });

    const sessionCall = fetchMock.mock.calls.find(([url]) =>
      (typeof url === "string" ? url : url.toString()).includes("/session"),
    );
    const url = sessionCall![0] as string;
    expect(url).toContain("conversationId=conv_persisted");
  });

  it("resume 404 → falls back to fresh session and clears storage", async () => {
    const storage = makeStorage({
      "agentui:default:conversationId": "conv_dead",
    });
    let callCount = 0;
    const fetchMock = makeFetchMock({
      "/session": (url) => {
        callCount++;
        // First call has conversationId param → return 404.
        // Subsequent calls (fresh) → return 200.
        if (url.includes("conversationId=") && callCount === 1) {
          return new Response("conversation not found", { status: 404 });
        }
        return new Response(JSON.stringify({ sessionId: "ses_fresh" }), { status: 200 });
      },
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    });
    const errors: AgentError[] = [];

    const { getByTestId } = render(
      <AgentRoot
        endpoint="/api/agent"
        storage={storage}
        fetch={fetchMock}
        onError={(err) => errors.push(err)}
      >
        <StatusProbe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });

    expect(getByTestId("session-id").textContent).toBe("ses_fresh");
    expect(storage._store.has("agentui:default:conversationId")).toBe(false);
    expect(errors.some((e) => e.kind === "session-resume")).toBe(true);
  });

  it("reset(): clears storage, dispatches __reset__, creates a new session", async () => {
    const storage = makeStorage({
      "agentui:default:conversationId": "conv_old",
    });
    const fetchMock = makeFetchMock({
      "/session": () =>
        new Response(JSON.stringify({ sessionId: "ses_1" }), { status: 200 }),
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    });

    function NodesProbe() {
      const nodes = useAgentNodes();
      return <span data-testid="nodes-count">{nodes.length}</span>;
    }

    function ResetButton() {
      const s = useAgentSession();
      return (
        <button data-testid="reset-btn" onClick={() => s.reset()}>
          reset
        </button>
      );
    }

    const { getByTestId } = render(
      <AgentRoot endpoint="/api/agent" storage={storage} fetch={fetchMock}>
        <StatusProbe />
        <NodesProbe />
        <ResetButton />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });

    // Inject a UI node via the stream.
    const es = MockEventSource.instances[0]!;
    const appendEvt: UIAppendEvent = {
      v: 1,
      id: "evt-append",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "ses_1",
      op: "ui.append",
      node: { key: "a", type: "test.node", props: {} },
    };
    act(() => {
      es.emit(appendEvt);
    });
    expect(getByTestId("nodes-count").textContent).toBe("1");

    // Reset.
    const resetCallCountBefore = fetchMock.mock.calls.filter(([u]) =>
      (typeof u === "string" ? u : u.toString()).includes("/session"),
    ).length;

    await act(async () => {
      getByTestId("reset-btn").click();
    });

    // Storage cleared; state cleared; a new POST has fired.
    await waitFor(() => {
      expect(storage._store.has("agentui:default:conversationId")).toBe(false);
      expect(getByTestId("nodes-count").textContent).toBe("0");
    });
    const resetCallCountAfter = fetchMock.mock.calls.filter(([u]) =>
      (typeof u === "string" ? u : u.toString()).includes("/session"),
    ).length;
    expect(resetCallCountAfter).toBeGreaterThan(resetCallCountBefore);
  });

  it("session.meta event → storage receives conversationId; useAgentSession reflects it", async () => {
    const storage = makeStorage();
    const fetchMock = makeFetchMock({
      "/session": () =>
        new Response(JSON.stringify({ sessionId: "ses_meta" }), { status: 200 }),
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    });

    const { getByTestId } = render(
      <AgentRoot endpoint="/api/agent" storage={storage} fetch={fetchMock}>
        <StatusProbe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });

    const es = MockEventSource.instances[0]!;
    act(() => {
      es.emit({
        v: 1,
        id: "evt-meta",
        ts: "2026-01-01T00:00:01Z",
        sessionId: "ses_meta",
        op: "session.meta",
        conversationId: "conv_new",
      });
    });

    await waitFor(() => {
      expect(getByTestId("conversation-id").textContent).toBe("conv_new");
    });
    expect(storage._store.get("agentui:default:conversationId")).toBe("conv_new");
  });
});
```

Note: the test file uses `beforeEach`. Add the import for it: `import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";`

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/react/test/agent-root.test.tsx`
Expected: failure — `AgentRoot` doesn't exist.

### Step 3: Create `packages/react/src/agent-root.tsx`

```tsx
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { AgentActionProvider, type ActionSender } from "./action-context.js";
import { AgentStateProvider } from "./agent-state-context.js";
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
  const doFetch = fetchProp ?? globalThis.fetch.bind(globalThis);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<AgentError | null>(null);
  // sessionStatus: tracks the HTTP side. Stream status is folded in below.
  const [sessionStatus, setSessionStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >(autoConnect ? "connecting" : "idle");

  // Sequence counter — only the most recent create()/resume() result is applied.
  const seqRef = useRef(0);

  // onError ref — stable callback access.
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
      // sessionStatus stays "connecting" until SSE opens; useAgentStream's
      // status flips us to "connected" via the effect below.
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
          // Stale conversation. Clear and fall back to fresh.
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

  // useAgentStream — instantiated as soon as we have a sessionId.
  // When sessionId is null we pass enabled: false to keep the hook stable.
  const handleEvent = useCallback(
    (event: AgentWireEvent) => {
      if (event.op === "session.meta") {
        setConversationId(event.conversationId);
        // Fire-and-forget; persistence failures shouldn't break the session.
        void Promise.resolve(storage.set(storageKey(id, "conversationId"), event.conversationId)).catch(() => {
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

  // Derive a combined status from sessionStatus + stream.status.
  const combinedStatus: "idle" | "connecting" | "connected" | "error" =
    error !== null
      ? "error"
      : sessionId === null
        ? sessionStatus // "idle" or "connecting" (when create/resume is in flight)
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

  // Auto-connect on mount.
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
    // Intentionally run once on mount. Subsequent control via session methods.
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

  // Default action sender — POSTs to {endpoint}/action.
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

  return (
    <SessionProvider value={sessionValue} config={configValue}>
      <AgentStateProvider store={stream.store}>
        <AgentActionProvider sender={actionSender}>{children}</AgentActionProvider>
      </AgentStateProvider>
    </SessionProvider>
  );
}
```

### Step 4: Export `AgentRoot` + related from `packages/react/src/index.ts`

Find a stable insertion point — anywhere among the existing exports. Add these blocks. The cleanest spot is at the very end of the file (the last existing export is likely the protocol type re-export).

After the existing protocol type re-export block, add:

```ts
export { AgentRoot } from "./agent-root.js";
export type { AgentRootProps } from "./agent-root.js";

export { SessionProvider, useAgentSession } from "./session-context.js";
export type { UseAgentSessionResult } from "./session-context.js";

export { localStorageAdapter } from "./storage-adapter.js";
export type { SessionStorageAdapter } from "./storage-adapter.js";

export type { AgentError } from "./agent-error.js";

export type { SessionMetaEvent } from "@kibadist/agentui-protocol";
```

The `SessionMetaEvent` re-export rides on the protocol re-exports.

### Step 5: Typecheck + run new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/agent-root.test.tsx`
Expected: typecheck clean; `5 passed`.

If a test fails with timing issues, increase `waitFor` timeout or wrap state-changing operations in `await act(async () => { ... })`. The current test code uses `waitFor` which retries until the assertion passes or 1s elapses.

### Step 6: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 7: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/agent-root.tsx packages/react/src/index.ts packages/react/test/agent-root.test.tsx
git commit -m "feat(react): add <AgentRoot> session lifecycle component"
```

---

## Task 5: `useAgentHistory` hook + tests

**Files:**
- Create: `packages/react/src/use-agent-history.ts`
- Modify: `packages/react/src/index.ts`
- Create: `packages/react/test/use-agent-history.test.tsx`

### Step 1: Write the failing tests

Create `packages/react/test/use-agent-history.test.tsx` with this exact content:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  AgentRoot,
  useAgentHistory,
} from "../src/index.js";
import type { SessionStorageAdapter } from "../src/index.js";

function makeStorage(): SessionStorageAdapter {
  const store = new Map<string, string>();
  return {
    get: (k) => store.get(k) ?? null,
    set: (k, v) => {
      store.set(k, v);
    },
    remove: (k) => {
      store.delete(k);
    },
  };
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState = MockEventSource.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }
}

beforeEach(() => {
  MockEventSource.instances.length = 0;
  // @ts-expect-error
  globalThis.EventSource = MockEventSource;
  (globalThis.EventSource as unknown as { CLOSED: number }).CLOSED = MockEventSource.CLOSED;
});

afterEach(() => {
  cleanup();
  // @ts-expect-error
  delete globalThis.EventSource;
});

function wrapInRoot(
  children: ReactNode,
  fetchMock: ReturnType<typeof vi.fn>,
): JSX.Element {
  return (
    <AgentRoot endpoint="/api/agent" storage={makeStorage()} fetch={fetchMock}>
      {children}
    </AgentRoot>
  );
}

describe("useAgentHistory", () => {
  it("fetches history on session start and exposes messages", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/session")) {
        return new Response(JSON.stringify({ sessionId: "s1" }), { status: 200 });
      }
      if (url.includes("/history")) {
        return new Response(
          JSON.stringify({
            messages: [
              { role: "user", text: "hello", ts: "2026-01-01T00:00:00Z" },
              { role: "assistant", text: "hi there", ts: "2026-01-01T00:00:01Z" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    function Probe() {
      const h = useAgentHistory();
      return (
        <>
          <span data-testid="loading">{h.loading ? "yes" : "no"}</span>
          <span data-testid="count">{h.messages.length}</span>
        </>
      );
    }

    const { getByTestId } = render(wrapInRoot(<Probe />, fetchMock));

    await waitFor(() => {
      expect(getByTestId("count").textContent).toBe("2");
    });
    expect(getByTestId("loading").textContent).toBe("no");
  });

  it("404 history → messages: [], no error fired", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/session")) {
        return new Response(JSON.stringify({ sessionId: "s2" }), { status: 200 });
      }
      if (url.includes("/history")) {
        return new Response("no history", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    });

    function Probe() {
      const h = useAgentHistory();
      return (
        <>
          <span data-testid="count">{h.messages.length}</span>
          <span data-testid="error">{h.error?.kind ?? "none"}</span>
        </>
      );
    }

    const { getByTestId } = render(wrapInRoot(<Probe />, fetchMock));

    // Wait for session to reach connected, then assert history outcome.
    await waitFor(() => {
      expect(getByTestId("count").textContent).toBe("0");
    });
    expect(getByTestId("error").textContent).toBe("none");
  });

  it("reload() re-fires the GET and replaces messages", async () => {
    let historyCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/session")) {
        return new Response(JSON.stringify({ sessionId: "s3" }), { status: 200 });
      }
      if (url.includes("/history")) {
        historyCallCount++;
        if (historyCallCount === 1) {
          return new Response(
            JSON.stringify({ messages: [{ role: "user", text: "one", ts: "t" }] }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            messages: [
              { role: "user", text: "one", ts: "t" },
              { role: "assistant", text: "two", ts: "t" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    function Probe() {
      const h = useAgentHistory();
      return (
        <>
          <span data-testid="count">{h.messages.length}</span>
          <button data-testid="reload-btn" onClick={() => h.reload()}>
            reload
          </button>
        </>
      );
    }

    const { getByTestId } = render(wrapInRoot(<Probe />, fetchMock));

    await waitFor(() => {
      expect(getByTestId("count").textContent).toBe("1");
    });

    await act(async () => {
      getByTestId("reload-btn").click();
    });

    await waitFor(() => {
      expect(getByTestId("count").textContent).toBe("2");
    });
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/react/test/use-agent-history.test.tsx`
Expected: failure — `useAgentHistory` doesn't exist.

### Step 3: Create `packages/react/src/use-agent-history.ts`

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentRootConfig, useAgentSession } from "./session-context.js";
import type { AgentError } from "./agent-error.js";

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

/**
 * Subscribe to the conversation history for the current session.
 * Fetches `GET {endpoint}/history?sessionId={sessionId}` once on session start.
 * Use `reload()` to refetch on demand.
 *
 * @param id Reserved for multi-agent support (DET-143). Ignored in v0.5.4.
 */
export function useAgentHistory(_id?: string): UseAgentHistoryResult {
  const { sessionId } = useAgentSession();
  const config = useAgentRootConfig();
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AgentError | null>(null);
  const seqRef = useRef(0);

  const fetchHistory = useCallback(
    async (sid: string): Promise<void> => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const url = `${config.endpoint}/history?sessionId=${encodeURIComponent(sid)}`;
        const res = await config.fetch(url, { method: "GET" });
        if (res.status === 404) {
          if (seq !== seqRef.current) return;
          setMessages([]);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          if (seq !== seqRef.current) return;
          setMessages([]);
          setLoading(false);
          setError({
            kind: "history-fetch",
            message: `History fetch failed: ${res.status} ${res.statusText}`,
            cause: res,
          });
          return;
        }
        const data = (await res.json()) as { messages: HistoryMessage[] };
        if (seq !== seqRef.current) return;
        setMessages(data.messages ?? []);
        setLoading(false);
      } catch (cause) {
        if (seq !== seqRef.current) return;
        setMessages([]);
        setLoading(false);
        setError({
          kind: "history-fetch",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
      }
    },
    [config],
  );

  // Fetch on sessionId change.
  useEffect(() => {
    if (sessionId !== null && sessionId !== "") {
      void fetchHistory(sessionId);
    } else {
      setMessages([]);
      setError(null);
      setLoading(false);
    }
  }, [sessionId, fetchHistory]);

  const reload = useCallback(async () => {
    if (sessionId !== null && sessionId !== "") {
      await fetchHistory(sessionId);
    }
  }, [sessionId, fetchHistory]);

  return { messages, loading, error, reload };
}
```

### Step 4: Export `useAgentHistory` from `packages/react/src/index.ts`

After the existing session-related exports added in Task 4, add:

```ts
export { useAgentHistory } from "./use-agent-history.js";
export type { HistoryMessage, UseAgentHistoryResult } from "./use-agent-history.js";
```

### Step 5: Typecheck + run new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/use-agent-history.test.tsx`
Expected: typecheck clean; `3 passed`.

### Step 6: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 7: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/use-agent-history.ts packages/react/src/index.ts packages/react/test/use-agent-history.test.tsx
git commit -m "feat(react): add useAgentHistory hook"
```

---

## Task 6: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

### Step 1: Edit `CHANGELOG.md`

Find the last bullet in `0.5.0` → `### Added — @kibadist/agentui-protocol`:

```md
- **Optimistic wire events.** Three new events for optimistic UI patterns: `optimistic.apply` (entityKey + patch + originId + optional ttlMs), `optimistic.confirm` (originId), `optimistic.rollback` (originId). Server-emittable AND client-dispatchable. New types: `OptimisticApplyEvent`, `OptimisticConfirmEvent`, `OptimisticRollbackEvent`, `OptimisticEvent` union, `OptimisticEventOp`. `AgentWireEvent` widens to include them.
```

After it, insert:

```md
- **Session lifecycle wire event.** New `session.meta` event carrying `conversationId`. `<AgentRoot>` (below) persists this for resume. New type: `SessionMetaEvent`. `AgentWireEvent` widens to include it.
```

Find the last bullet in `0.5.0` → `### Added — @kibadist/agentui-validate`:

```md
- `optimisticEventSchema` is exported. `agentWireEventSchema` widens to include the three optimistic event schemas (16 total variants now).
```

After it, insert:

```md
- `sessionMetaSchema` is exported. `agentWireEventSchema` widens to 17 variants.
```

Find the last bullet in `0.5.0` → `### Added — @kibadist/agentui-react`:

```md
- **`useAgentStream().dispatch` widens to `AgentWireEvent`.** Consumers can now fire `optimistic.apply` (and any other wire event) from React code. Existing callers passing plain `UIEvent` continue to type-check unchanged. The library does NOT schedule TTL timers — hosts implement expiry via `useEffect` over `useOptimisticAll()` and dispatching `optimistic.rollback`. Documented pattern in README.
```

After it, insert these four bullets:

```md
- **`<AgentRoot endpoint="...">`** — single mount-point that bundles session create/resume, conversationId persistence (pluggable `SessionStorageAdapter`), stream wiring, and action dispatching. Replaces ~80 lines of host plumbing.
- **`useAgentSession()`** — subscribe to session lifecycle (`sessionId`, `conversationId`, `status`, `error`, `create`, `resume`, `reset`, `close`). Must be used inside `<AgentRoot>`.
- **`useAgentHistory()`** — fetches `GET {endpoint}/history?sessionId={sessionId}` on session start. 404 resolves to an empty list (no error fired). `reload()` re-fetches.
- **`localStorageAdapter`** (default) and the `SessionStorageAdapter` interface (pluggable for React Native AsyncStorage). New `AgentError` type with discriminated `kind` (`session-create` / `session-resume` / `history-fetch` / `stream`).
```

### Step 2: Edit `README.md`

Find the existing "Optimistic updates" subsection's closing line:

```md
`confirm` and `rollback` both remove the entry — the semantic difference is host-side intent (telemetry, success/error animation). The library does **not** start TTL timers; if you want client-side expiry, watch `useOptimisticAll()` from a `useEffect` and dispatch `optimistic.rollback` when an entry's `expiresAt` passes.
```

After this line, BEFORE the next subsection or `---` separator, insert a new H3 subsection:

```md

### Quick start with `<AgentRoot>`

For new apps, mount `<AgentRoot>` at the top of your tree. It handles session creation, conversation resume, and history rehydration in one place — and provides all the selector-hook context children need.

```tsx
import {
  AgentRoot,
  useAgentSession,
  useAgentHistory,
  useAgentNodes,
} from "@kibadist/agentui-react";

export function App() {
  return (
    <AgentRoot endpoint="/api/agent">
      <Chat />
    </AgentRoot>
  );
}

function Chat() {
  const { status, conversationId, reset } = useAgentSession();
  const { messages } = useAgentHistory();
  const nodes = useAgentNodes();

  if (status === "connecting") return <div>Connecting…</div>;
  if (status === "error") return <button onClick={() => reset()}>Reconnect</button>;

  return (
    <div>
      <ul>{messages.map((m, i) => <li key={i}>{m.role}: {m.text}</li>)}</ul>
      <div>{nodes.map((n) => /* render via registry */ null)}</div>
    </div>
  );
}
```

`<AgentRoot>` reads/writes `conversationId` via `localStorage` by default. For React Native, pass `storage={asyncStorageAdapter}` (host-defined wrapper around AsyncStorage that implements the `SessionStorageAdapter` interface). For auth wrappers, pass a custom `fetch={authedFetch}`.

The component expects three endpoints (relative to `endpoint`):
- `POST /session` — accepts optional `?conversationId=` to resume; returns `{ sessionId }`.
- `GET /stream?sessionId=...` — SSE stream emitting validated wire events.
- `GET /history?sessionId=...` — returns `{ messages: HistoryMessage[] }`. 404 is treated as "no history yet" and not an error.
```

### Step 3: Run the full suite as a smoke check

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 4: Commit

```bash
cd /Users/max/agentui
git add CHANGELOG.md README.md
git commit -m "docs: document <AgentRoot> + useAgentSession + useAgentHistory (0.5.0)"
```

---

## Verification — done when

- [ ] `pnpm test` passes — adds 2 schema + 5 component + 3 hook = 10 new tests.
- [ ] `pnpm typecheck` clean across all packages.
- [ ] `pnpm --filter @kibadist/agentui-react build` clean.
- [ ] `git log --oneline` shows the six task commits in order.
- [ ] No version bumps in `package.json` files.
- [ ] DET-142 transitioned to "Done" in Linear after the last commit lands.

## Out of scope (restated)

- Multi-agent context isolation (`id` prop semantics) — DET-143.
- Path-segment stream URL — defer.
- Conversation switching / list — host concern.
- Live history streaming.
- WebSocket fallback — DET-149.
