# Multi-Agent Namespacing Implementation Plan (DET-143)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow two or more `<AgentRoot>` instances to coexist in the same tree via a linked-list registry. All hooks gain an optional `id` parameter; id-less calls continue working unchanged (resolve to nearest root).

**Architecture:** New `AgentRootRegistry` context carries each AgentRoot's `{ id, session, config, store, actionSender, parent }`. Each `<AgentRoot>` reads the parent entry from context, builds its own, and provides via the registry. The existing four contexts (`SessionContext`, `AgentRootConfigContext`, `AgentStateContext`, `AgentActionContext`) remain in place for the id-less zero-overhead path. Hooks: id-less uses the legacy context; id-aware walks the registry.

**Tech Stack:** TypeScript strict, React 19. No new runtime deps.

**Spec:** [docs/superpowers/specs/2026-05-18-multi-agent-namespacing-design.md](../specs/2026-05-18-multi-agent-namespacing-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/react/src/agent-root-registry.tsx` | Create | Registry context + `AgentRootRegistryEntry` + `resolveAgentRoot` helper + `useAgentRootRegistryEntry` |
| `packages/react/src/agent-root.tsx` | Modify | Read parent entry; mount-time duplicate-id check; provide registry entry |
| `packages/react/src/session-context.tsx` | Modify | Activate `id` on `useAgentSession`; add `id` on `useAgentRootConfig` |
| `packages/react/src/action-context.tsx` | Modify | `useAgentAction(id?)` |
| `packages/react/src/use-agent-history.ts` | Modify | `useAgentHistory(id?)` forwards `id` to inner hooks |
| `packages/react/src/selectors.ts` | Modify | `useResolvedStore(id?)` helper; `useAgentSelector(selector, eq?, id?)`; convenience hooks forward `id` |
| `packages/react/src/index.ts` | Modify | Export `AgentRootRegistry`, `useAgentRootRegistryEntry`, `resolveAgentRoot`, `AgentRootRegistryEntry` type |
| `packages/react/test/multi-agent.test.tsx` | Create | 5 integration tests |
| `CHANGELOG.md` | Modify | Extend existing 0.5.0 |
| `README.md` | Modify | One paragraph under "Quick start with `<AgentRoot>`" |

---

## Conventions

- All commands run from `/Users/max/agentui`.
- Tests: `pnpm test` (one-shot — wired to `vitest run`). NEVER watch mode.
- Typecheck: `pnpm typecheck`.
- ESM `.js` relative imports throughout.

---

## Task 1: Registry context + AgentRoot integration

**Files:**
- Create: `packages/react/src/agent-root-registry.tsx`
- Modify: `packages/react/src/agent-root.tsx`

No new tests in this task — Task 4 covers integration. Existing tests must keep passing (verifies the change is backward-compatible for id-less use).

### Step 1: Create `packages/react/src/agent-root-registry.tsx`

```tsx
"use client";

import { createContext, useContext } from "react";
import type { ActionSender } from "./action-context.js";
import type { AgentStore } from "./store.js";
import type { AgentRootConfig, UseAgentSessionResult } from "./session-context.js";

/**
 * One entry in the linked list of `<AgentRoot>` instances in the tree.
 * Each `<AgentRoot>` builds its own entry pointing back at its parent.
 * Walk the list via `resolveAgentRoot` to find a specific `id`.
 */
export interface AgentRootRegistryEntry {
  id: string | undefined;
  session: UseAgentSessionResult;
  config: AgentRootConfig;
  store: AgentStore;
  actionSender: ActionSender;
  parent: AgentRootRegistryEntry | null;
}

export const AgentRootRegistry = createContext<AgentRootRegistryEntry | null>(null);

/** Read the nearest registry entry (the deepest `<AgentRoot>` ancestor's). */
export function useAgentRootRegistryEntry(): AgentRootRegistryEntry | null {
  return useContext(AgentRootRegistry);
}

/**
 * Walk the linked list looking for an entry whose `id` matches. With
 * `undefined`, returns the entry itself (nearest, regardless of id).
 * Returns null if no match.
 */
export function resolveAgentRoot(
  entry: AgentRootRegistryEntry | null,
  id: string | undefined,
): AgentRootRegistryEntry | null {
  if (entry === null) return null;
  if (id === undefined) return entry;
  if (entry.id === id) return entry;
  return resolveAgentRoot(entry.parent, id);
}
```

### Step 2: Modify `packages/react/src/agent-root.tsx`

**Edit A** — Add the registry import. Find the top imports:

```tsx
import { AgentActionProvider, type ActionSender } from "./action-context.js";
import { AgentStateProvider } from "./agent-state-context.js";
import { SessionProvider, type UseAgentSessionResult } from "./session-context.js";
import { useAgentStream } from "./use-agent-stream.js";
import { localStorageAdapter, type SessionStorageAdapter } from "./storage-adapter.js";
import type { AgentError } from "./agent-error.js";
```

Replace with:

```tsx
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
```

Also widen the React imports if needed — ensure `useContext` is imported:

```tsx
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
```

**Edit B** — Inside the `AgentRoot` function body, AFTER the existing `const configValue = useMemo(...)` line, add:

```tsx
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
```

**Edit C** — Wrap the existing return with `AgentRootRegistry.Provider`. Find:

```tsx
  return (
    <SessionProvider value={sessionValue} config={configValue}>
      <AgentStateProvider store={stream.store}>
        <AgentActionProvider sender={actionSender}>{children}</AgentActionProvider>
      </AgentStateProvider>
    </SessionProvider>
  );
}
```

Replace with:

```tsx
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
```

### Step 3: Typecheck

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck`
Expected: clean.

### Step 4: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all 99 tests pass (no behavior change for existing id-less consumers).

### Step 5: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/agent-root-registry.tsx packages/react/src/agent-root.tsx
git commit -m "feat(react): add AgentRootRegistry context for multi-agent namespacing"
```

---

## Task 2: Hooks — id support for session/history/action

**Files:**
- Modify: `packages/react/src/session-context.tsx`
- Modify: `packages/react/src/action-context.tsx`
- Modify: `packages/react/src/use-agent-history.ts`

No new tests — Task 4 covers integration. Existing tests must keep passing.

### Step 1: Modify `packages/react/src/session-context.tsx`

**Edit A** — Update imports. Find:

```ts
import { createContext, useContext, type ReactNode } from "react";
import type { AgentError } from "./agent-error.js";
```

Replace with:

```ts
import { createContext, useContext, type ReactNode } from "react";
import type { AgentError } from "./agent-error.js";
import {
  resolveAgentRoot,
  useAgentRootRegistryEntry,
} from "./agent-root-registry.js";
```

**Edit B** — Update `useAgentSession`. Find:

```ts
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
```

Replace with:

```ts
export function useAgentSession(id?: string): UseAgentSessionResult {
  const nearest = useContext(SessionContext);
  const entry = useAgentRootRegistryEntry();

  if (id !== undefined) {
    const resolved = resolveAgentRoot(entry, id);
    if (resolved === null) {
      throw new Error(`[agentui] No <AgentRoot id="${id}"> found in the tree.`);
    }
    return resolved.session;
  }

  if (nearest === null) {
    throw new Error(
      "[agentui] useAgentSession must be used inside <AgentRoot>. " +
        "Wrap your tree in <AgentRoot endpoint=\"...\">.",
    );
  }
  return nearest;
}
```

**Edit C** — Update `useAgentRootConfig`. Find:

```ts
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

Replace with:

```ts
export function useAgentRootConfig(id?: string): AgentRootConfig {
  const nearest = useContext(AgentRootConfigContext);
  const entry = useAgentRootRegistryEntry();

  if (id !== undefined) {
    const resolved = resolveAgentRoot(entry, id);
    if (resolved === null) {
      throw new Error(`[agentui] No <AgentRoot id="${id}"> found in the tree.`);
    }
    return resolved.config;
  }

  if (nearest === null) {
    throw new Error(
      "[agentui] useAgentRootConfig must be used inside <AgentRoot>.",
    );
  }
  return nearest;
}
```

### Step 2: Modify `packages/react/src/action-context.tsx`

Find:

```tsx
/**
 * Hook to dispatch an action back to the agent.
 * Components should use this instead of calling fetch directly.
 */
export function useAgentAction(): ActionSender {
  return useContext(AgentActionContext);
}
```

Replace with:

```tsx
import {
  resolveAgentRoot,
  useAgentRootRegistryEntry,
} from "./agent-root-registry.js";

/**
 * Hook to dispatch an action back to the agent.
 * Components should use this instead of calling fetch directly.
 *
 * @param id Resolve to the `<AgentRoot id="...">` with this id. Omit for the
 *   nearest agent (current behavior).
 */
export function useAgentAction(id?: string): ActionSender {
  const nearest = useContext(AgentActionContext);
  const entry = useAgentRootRegistryEntry();

  if (id !== undefined) {
    const resolved = resolveAgentRoot(entry, id);
    if (resolved === null) {
      throw new Error(`[agentui] No <AgentRoot id="${id}"> found in the tree.`);
    }
    return resolved.actionSender;
  }

  return nearest;
}
```

Add `import { resolveAgentRoot, useAgentRootRegistryEntry } from "./agent-root-registry.js";` near the top alongside the other imports if it's not already in place.

### Step 3: Modify `packages/react/src/use-agent-history.ts`

Find the function signature:

```ts
export function useAgentHistory(_id?: string): UseAgentHistoryResult {
  const { sessionId } = useAgentSession();
  const config = useAgentRootConfig();
```

Replace with:

```ts
export function useAgentHistory(id?: string): UseAgentHistoryResult {
  const { sessionId } = useAgentSession(id);
  const config = useAgentRootConfig(id);
```

(Only two lines change: the parameter name `_id` → `id`, and the two inner hook calls accept `id`.)

### Step 4: Typecheck

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck`
Expected: clean.

### Step 5: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all 99 tests pass.

### Step 6: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/session-context.tsx packages/react/src/action-context.tsx packages/react/src/use-agent-history.ts
git commit -m "feat(react): id-aware useAgentSession, useAgentAction, useAgentHistory"
```

---

## Task 3: Selectors — id support

**Files:**
- Modify: `packages/react/src/selectors.ts`

### Step 1: Modify `packages/react/src/selectors.ts`

**Edit A** — Update imports. Find:

```ts
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState, ToolCall, ReasoningSegment, OptimisticEntry } from "./reducer.js";
```

Replace with:

```ts
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState, ToolCall, ReasoningSegment, OptimisticEntry } from "./reducer.js";
import type { AgentStore } from "./store.js";
import {
  resolveAgentRoot,
  useAgentRootRegistryEntry,
} from "./agent-root-registry.js";
```

**Edit B** — Add a `useResolvedStore` helper. AFTER the existing `UNSET` sentinel constant (near the top of the file), insert:

```ts
function useResolvedStore(id: string | undefined): AgentStore {
  const fromContext = useAgentStore(); // throws if no provider
  const entry = useAgentRootRegistryEntry();
  if (id === undefined) return fromContext;
  const resolved = resolveAgentRoot(entry, id);
  if (resolved === null) {
    throw new Error(`[agentui] No <AgentRoot id="${id}"> found in the tree.`);
  }
  return resolved.store;
}
```

**Edit C** — Update `useAgentSelector` to accept and use the `id` parameter. Find:

```ts
export function useAgentSelector<T>(
  selector: (state: AgentState) => T,
  eq: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useAgentStore();
  const selRef = useRef(selector);
  selRef.current = selector;
```

Replace with:

```ts
export function useAgentSelector<T>(
  selector: (state: AgentState) => T,
  eq: (a: T, b: T) => boolean = Object.is,
  id?: string,
): T {
  const store = useResolvedStore(id);
  const selRef = useRef(selector);
  selRef.current = selector;
```

(Only the parameter list and the first body line change.)

**Edit D** — Update convenience hooks to forward `id`. Find:

```ts
export const useAgentNodes = () => useAgentSelector((s) => s.nodes);
export const useAgentToasts = () => useAgentSelector((s) => s.toasts);
export const useAgentNavigate = () => useAgentSelector((s) => s.navigate);
```

Replace with:

```ts
export const useAgentNodes = (id?: string) =>
  useAgentSelector((s) => s.nodes, undefined, id);

export const useAgentToasts = (id?: string) =>
  useAgentSelector((s) => s.toasts, undefined, id);

export const useAgentNavigate = (id?: string) =>
  useAgentSelector((s) => s.navigate, undefined, id);
```

**Edit E** — Update tool-call convenience hooks. Find:

```ts
export function useToolCalls(): ToolCall[] {
  return useAgentSelector(
    (s) => {
      const arr: ToolCall[] = [];
      for (const id of s.toolCallsOrder) {
        const c = s.toolCalls.get(id);
        if (c) arr.push(c);
      }
      return arr;
    },
    (a, b) => a.length === b.length && a.every((c, i) => c === b[i]),
  );
}

export function useToolCall(id: string): ToolCall | undefined {
  return useAgentSelector((s) => s.toolCalls.get(id));
}
```

Replace with:

```ts
export function useToolCalls(id?: string): ToolCall[] {
  return useAgentSelector(
    (s) => {
      const arr: ToolCall[] = [];
      for (const callId of s.toolCallsOrder) {
        const c = s.toolCalls.get(callId);
        if (c) arr.push(c);
      }
      return arr;
    },
    (a, b) => a.length === b.length && a.every((c, i) => c === b[i]),
    id,
  );
}

export function useToolCall(callId: string, id?: string): ToolCall | undefined {
  return useAgentSelector((s) => s.toolCalls.get(callId), undefined, id);
}
```

Note: `useToolCall`'s parameter list reorders — `callId` is now the FIRST positional and `id` (the agent id) is SECOND. The original signature was `useToolCall(id: string)` where `id` was the call id. To keep call sites working we rename the param from `id` to `callId` and add `id?` as the agent-id param.

This IS a backwards-incompatible rename of the first parameter's name (positional unchanged — same type, same first slot — so call sites work) but the conceptual rename matters for clarity.

Also: the inner loop variable in `useToolCalls` was named `id`; renamed to `callId` to avoid shadowing the new outer `id` parameter.

**Edit F** — Update reasoning hooks. Find:

```ts
export function useReasoning(): ReasoningSegment[] {
  return useAgentSelector(
    (s) => {
      const arr: ReasoningSegment[] = [];
      for (const id of s.reasoningOrder) {
        const seg = s.reasoning.get(id);
        if (seg) arr.push(seg);
      }
      return arr;
    },
    (a, b) => a.length === b.length && a.every((seg, i) => seg === b[i]),
  );
}

export function useLatestReasoning(): ReasoningSegment | undefined {
  return useAgentSelector((s) => {
    const order = s.reasoningOrder;
    if (order.length === 0) return undefined;
    return s.reasoning.get(order[order.length - 1]);
  });
}
```

Replace with:

```ts
export function useReasoning(id?: string): ReasoningSegment[] {
  return useAgentSelector(
    (s) => {
      const arr: ReasoningSegment[] = [];
      for (const segId of s.reasoningOrder) {
        const seg = s.reasoning.get(segId);
        if (seg) arr.push(seg);
      }
      return arr;
    },
    (a, b) => a.length === b.length && a.every((seg, i) => seg === b[i]),
    id,
  );
}

export function useLatestReasoning(id?: string): ReasoningSegment | undefined {
  return useAgentSelector(
    (s) => {
      const order = s.reasoningOrder;
      if (order.length === 0) return undefined;
      return s.reasoning.get(order[order.length - 1]);
    },
    undefined,
    id,
  );
}
```

(Inner loop variable `id` renamed to `segId` to avoid shadowing.)

**Edit G** — Update optimistic hooks. Find:

```ts
export function useOptimistic(entityKey: string): Record<string, unknown> | undefined {
  return useAgentSelector((s) => s.optimistic.get(entityKey)?.patch);
}

export function useOptimisticAll(): Map<string, OptimisticEntry> {
  return useAgentSelector((s) => s.optimistic);
}
```

Replace with:

```ts
export function useOptimistic(entityKey: string, id?: string): Record<string, unknown> | undefined {
  return useAgentSelector((s) => s.optimistic.get(entityKey)?.patch, undefined, id);
}

export function useOptimisticAll(id?: string): Map<string, OptimisticEntry> {
  return useAgentSelector((s) => s.optimistic, undefined, id);
}
```

### Step 2: Typecheck

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck`
Expected: clean.

### Step 3: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all 99 tests pass. Existing call sites pass the same positional arguments; the new optional `id` slot is untouched.

### Step 4: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/selectors.ts
git commit -m "feat(react): id-aware useAgentSelector and convenience hooks"
```

---

## Task 4: Multi-agent integration tests

**Files:**
- Create: `packages/react/test/multi-agent.test.tsx`
- Modify: `packages/react/src/index.ts` (export registry helpers)

### Step 1: Write the failing tests

Create `packages/react/test/multi-agent.test.tsx` with this exact content:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";
import {
  AgentRoot,
  useAgentNodes,
  useAgentSession,
} from "../src/index.js";
import type { SessionStorageAdapter, UIAppendEvent } from "../src/index.js";

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

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

function makeFetchMock(
  sessionResponses: Record<string, string>,
): ReturnType<typeof vi.fn> {
  // sessionResponses maps endpoint path → sessionId returned for that endpoint's /session POST.
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [endpoint, sessionId] of Object.entries(sessionResponses)) {
      if (url.startsWith(endpoint)) {
        if (url.includes("/session")) {
          return new Response(JSON.stringify({ sessionId }), { status: 200 });
        }
        if (url.includes("/history")) {
          return new Response(JSON.stringify({ messages: [] }), { status: 200 });
        }
      }
    }
    return new Response("not found", { status: 404 });
  });
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

describe("multi-agent namespacing", () => {
  it("two nested roots; scoped hooks resolve to the right one", async () => {
    const fetchMock = makeFetchMock({
      "/api/chat": "ses_chat",
      "/api/planner": "ses_planner",
    });

    function Probe() {
      const chat = useAgentSession("chat");
      const planner = useAgentSession("planner");
      return (
        <>
          <span data-testid="chat-sid">{chat.sessionId ?? ""}</span>
          <span data-testid="planner-sid">{planner.sessionId ?? ""}</span>
        </>
      );
    }

    const { getByTestId } = render(
      <AgentRoot id="chat" endpoint="/api/chat" storage={makeStorage()} fetch={fetchMock}>
        <AgentRoot id="planner" endpoint="/api/planner" storage={makeStorage()} fetch={fetchMock}>
          <Probe />
        </AgentRoot>
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("chat-sid").textContent).toBe("ses_chat");
      expect(getByTestId("planner-sid").textContent).toBe("ses_planner");
    });
  });

  it("hook without id resolves to the nearest root", async () => {
    const fetchMock = makeFetchMock({
      "/api/chat": "ses_chat",
      "/api/planner": "ses_planner",
    });

    function Probe() {
      const nearest = useAgentSession(); // no id
      return <span data-testid="nearest-sid">{nearest.sessionId ?? ""}</span>;
    }

    const { getByTestId } = render(
      <AgentRoot id="chat" endpoint="/api/chat" storage={makeStorage()} fetch={fetchMock}>
        <AgentRoot id="planner" endpoint="/api/planner" storage={makeStorage()} fetch={fetchMock}>
          <Probe />
        </AgentRoot>
      </AgentRoot>,
    );

    // Nearest from inside the planner root is planner.
    await waitFor(() => {
      expect(getByTestId("nearest-sid").textContent).toBe("ses_planner");
    });
  });

  it("hook with unknown id throws", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = makeFetchMock({
      "/api/chat": "ses_chat",
    });

    function Probe() {
      // This call should throw at render.
      useAgentSession("planner");
      return <span data-testid="probe" />;
    }

    expect(() =>
      render(
        <AgentRoot id="chat" endpoint="/api/chat" storage={makeStorage()} fetch={fetchMock}>
          <Probe />
        </AgentRoot>,
      ),
    ).toThrow(/No <AgentRoot id="planner">/);

    errSpy.mockRestore();
  });

  it("duplicate id at nested AgentRoots throws at mount", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = makeFetchMock({
      "/api/a": "ses_a",
      "/api/b": "ses_b",
    });

    expect(() =>
      render(
        <AgentRoot id="chat" endpoint="/api/a" storage={makeStorage()} fetch={fetchMock}>
          <AgentRoot id="chat" endpoint="/api/b" storage={makeStorage()} fetch={fetchMock}>
            <span />
          </AgentRoot>
        </AgentRoot>,
      ),
    ).toThrow(/Duplicate <AgentRoot id="chat">/);

    errSpy.mockRestore();
  });

  it("useAgentNodes(id) resolves to the right store", async () => {
    const fetchMock = makeFetchMock({
      "/api/chat": "ses_chat",
      "/api/planner": "ses_planner",
    });

    function Probe() {
      const chatNodes = useAgentNodes("chat");
      const plannerNodes = useAgentNodes("planner");
      return (
        <>
          <span data-testid="chat-count">{chatNodes.length}</span>
          <span data-testid="planner-count">{plannerNodes.length}</span>
        </>
      );
    }

    const { getByTestId } = render(
      <AgentRoot id="chat" endpoint="/api/chat" storage={makeStorage()} fetch={fetchMock}>
        <AgentRoot id="planner" endpoint="/api/planner" storage={makeStorage()} fetch={fetchMock}>
          <Probe />
        </AgentRoot>
      </AgentRoot>,
    );

    // Wait for both SSE connections to open.
    await waitFor(() => {
      expect(MockEventSource.instances.length).toBe(2);
    });

    // Inject an event into chat's SSE.
    // Order of EventSource creation: chat first (outer mount), then planner.
    const chatES = MockEventSource.instances[0]!;
    const plannerES = MockEventSource.instances[1]!;

    const chatEvt: UIAppendEvent = {
      v: 1,
      id: "evt-c",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "ses_chat",
      op: "ui.append",
      node: { key: "c1", type: "test.node", props: {} },
    };
    const plannerEvt: UIAppendEvent = {
      v: 1,
      id: "evt-p1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "ses_planner",
      op: "ui.append",
      node: { key: "p1", type: "test.node", props: {} },
    };
    const plannerEvt2: UIAppendEvent = {
      v: 1,
      id: "evt-p2",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "ses_planner",
      op: "ui.append",
      node: { key: "p2", type: "test.node", props: {} },
    };

    act(() => {
      chatES.emit(chatEvt);
      plannerES.emit(plannerEvt);
      plannerES.emit(plannerEvt2);
    });

    expect(getByTestId("chat-count").textContent).toBe("1");
    expect(getByTestId("planner-count").textContent).toBe("2");
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/react/test/multi-agent.test.tsx`
Expected: failure — the test references types like `UIAppendEvent` from `../src/index.js` (re-exported) and uses `useAgentNodes(id)` which is the new signature. If the registry helpers aren't exported, the test imports may not resolve.

### Step 3: Export registry symbols from `packages/react/src/index.ts`

Find the existing block (added in Task 4 of DET-142):

```ts
export { AgentRoot } from "./agent-root.js";
export type { AgentRootProps } from "./agent-root.js";
```

After it, add:

```ts
export {
  AgentRootRegistry,
  resolveAgentRoot,
  useAgentRootRegistryEntry,
} from "./agent-root-registry.js";
export type { AgentRootRegistryEntry } from "./agent-root-registry.js";
```

### Step 4: Typecheck + run new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/multi-agent.test.tsx`
Expected: typecheck clean; `5 passed`.

### Step 5: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass (104 tests across 23 files).

### Step 6: Commit

```bash
cd /Users/max/agentui
git add packages/react/test/multi-agent.test.tsx packages/react/src/index.ts
git commit -m "test(react): multi-agent integration tests + registry exports"
```

---

## Task 5: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

### Step 1: Edit `CHANGELOG.md`

Find the last bullet in `0.5.0` → `### Added — @kibadist/agentui-react` list. After it, insert:

```md
- **Multi-agent namespacing.** `<AgentRoot id="...">` registers itself in an `AgentRootRegistry` context; nested `<AgentRoot>` instances form a linked list. All hooks gain an optional `id` parameter — `useAgentSession('chat')`, `useAgentNodes('planner')`, etc. — to scope lookups to a specific agent. Id-less calls keep current nearest-scope behavior (zero overhead). Duplicate ids in the same nested chain throw at mount.
```

### Step 2: Edit `README.md`

Find the existing "Quick start with `<AgentRoot>`" subsection. After its closing paragraph (the one starting with "The component expects three endpoints"), BEFORE the next subsection or `---` separator, insert this paragraph:

```md

**Multiple agents in one app.** Nest `<AgentRoot id="...">` to run two or more agents side-by-side:

```tsx
<AgentRoot id="chat" endpoint="/api/chat">
  <AgentRoot id="planner" endpoint="/api/planner">
    <App />
  </AgentRoot>
</AgentRoot>
```

All hooks accept an optional `id` argument to target a specific agent: `useAgentSession('chat')`, `useAgentNodes('planner')`, `useToolCalls('chat')`, and so on. Without an id, hooks resolve to the nearest `<AgentRoot>` ancestor (the current single-agent behavior, unchanged).
```

### Step 3: Run the full suite as a smoke check

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 4: Commit

```bash
cd /Users/max/agentui
git add CHANGELOG.md README.md
git commit -m "docs: document multi-agent namespacing (0.5.0)"
```

---

## Verification — done when

- [ ] `pnpm test` passes — adds 5 new tests (multi-agent integration).
- [ ] `pnpm typecheck` clean across all packages.
- [ ] `pnpm --filter @kibadist/agentui-react build` clean.
- [ ] `git log --oneline` shows the five task commits in order.
- [ ] No version bumps in `package.json` files.
- [ ] DET-143 transitioned to "Done" in Linear after the last commit lands.

## Out of scope (restated)

- Cross-agent state synchronization.
- "Find by predicate" / discovery APIs.
- DevTools naming improvements beyond what falls out of the existing context structure.
- Replacing the legacy contexts — additive only.
