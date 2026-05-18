# Testing Subpath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@kibadist/agentui-react/testing` so consumers stop hand-rolling vitest mocks. Four helpers (`createMockAgentStream`, `pushEvent`, `replayConversation`, `createTestRegistry`) live under a new `src/testing/` directory, built to `dist/testing/`, exposed via a subpath in the package's `exports` map.

**Architecture:** New `packages/react/src/testing/` subdirectory built alongside `src/` by the existing `tsc` invocation. One file per helper concern. Test files in `packages/react/test/testing/` use relative imports (`../../src/testing/...`) to validate each helper independently of the subpath resolution; the subpath itself is verified by checking that `dist/testing/index.js` and `dist/testing/index.d.ts` exist after build. No new runtime deps.

**Tech Stack:** TypeScript strict, React 19, vitest + jsdom + @testing-library/react. Builds via the existing `pnpm --filter @kibadist/agentui-react build` (`tsc`).

**Spec:** [docs/superpowers/specs/2026-05-18-testing-subpath-design.md](../specs/2026-05-18-testing-subpath-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/react/src/testing/replay.ts` | Create | `pushEvent`, `replayConversation` — pure reducer helpers |
| `packages/react/src/testing/test-registry.tsx` | Create | `createTestRegistry` + module-scoped marker cache |
| `packages/react/src/testing/mock-agent-stream.ts` | Create | `createMockAgentStream` — hook + control surface |
| `packages/react/src/testing/index.ts` | Create | Public re-exports for the subpath |
| `packages/react/package.json` | Modify | Add `"./testing"` to `exports` |
| `packages/react/test/testing/replay.test.ts` | Create | 2 tests |
| `packages/react/test/testing/test-registry.test.tsx` | Create | 3 tests |
| `packages/react/test/testing/mock-agent-stream.test.tsx` | Create | 4 tests |
| `CHANGELOG.md` | Modify | Append to existing `0.4.0` |
| `README.md` | Modify | Short subsection under "Granular state selectors" |

The plan does NOT modify `tsconfig.json`: its `include: ["src"]` already globs `src/testing/**` recursively, so new files build automatically.

---

## Conventions used throughout this plan

- All commands run from `/Users/max/agentui`.
- Tests: `pnpm test` (one-shot — wired to `vitest run`). **Never** invoke watch mode.
- Typecheck: `pnpm --filter @kibadist/agentui-react typecheck`.
- Build: `pnpm --filter @kibadist/agentui-react build`.
- ESM-only repo: relative imports use `.js` extension even for `.ts` source files.
- Helpers reused across the new test files (declared at the top of each file that needs them):

```ts
import type { UIEvent, UIAppendEvent, UIRemoveEvent, UIReplaceEvent, UIToastEvent, UINavigateEvent } from "@kibadist/agentui-protocol";

function appendEvent(key: string): UIAppendEvent {
  return { v: 1, id: `evt-a-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.append", node: { key, type: "test.node", props: {} } };
}
function replaceEvent(key: string, props: Record<string, unknown>): UIReplaceEvent {
  return { v: 1, id: `evt-r-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.replace", key, props };
}
function removeEvent(key: string): UIRemoveEvent {
  return { v: 1, id: `evt-x-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.remove", key };
}
function toastEvent(message: string): UIToastEvent {
  return { v: 1, id: `evt-t-${message}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.toast", level: "info", message };
}
function navigateEvent(href: string): UINavigateEvent {
  return { v: 1, id: `evt-n-${href}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.navigate", href };
}
```

---

## Task 1: `replay.ts` + tests — pure reducer helpers

**Files:**
- Create: `packages/react/src/testing/replay.ts`
- Create: `packages/react/test/testing/replay.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/react/test/testing/replay.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type {
  UIAppendEvent,
  UINavigateEvent,
  UIRemoveEvent,
  UIReplaceEvent,
  UIToastEvent,
  UIEvent,
} from "@kibadist/agentui-protocol";
import { createInitialAgentState } from "../../src/index.js";
import { pushEvent, replayConversation } from "../../src/testing/replay.js";

function appendEvent(key: string): UIAppendEvent {
  return { v: 1, id: `evt-a-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.append", node: { key, type: "test.node", props: {} } };
}
function replaceEvent(key: string, props: Record<string, unknown>): UIReplaceEvent {
  return { v: 1, id: `evt-r-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.replace", key, props };
}
function removeEvent(key: string): UIRemoveEvent {
  return { v: 1, id: `evt-x-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.remove", key };
}
function toastEvent(message: string): UIToastEvent {
  return { v: 1, id: `evt-t-${message}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.toast", level: "info", message };
}
function navigateEvent(href: string): UINavigateEvent {
  return { v: 1, id: `evt-n-${href}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.navigate", href };
}

describe("pushEvent", () => {
  it("runs one event through the reducer and returns a fresh state reference", () => {
    const s0 = createInitialAgentState();
    const s1 = pushEvent(s0, appendEvent("a"));
    expect(s1.nodes).toHaveLength(1);
    expect(s1.nodes[0].key).toBe("a");
    expect(s1).not.toBe(s0);
  });
});

describe("replayConversation", () => {
  it("folds a 10-event mixed sequence to the expected state", () => {
    const events: UIEvent[] = [
      appendEvent("a"),
      appendEvent("b"),
      appendEvent("c"),
      replaceEvent("b", { x: 1 }),
      toastEvent("hello"),
      appendEvent("d"),
      removeEvent("a"),
      toastEvent("world"),
      navigateEvent("/dashboard"),
      replaceEvent("d", { y: 2 }),
    ];

    const state = replayConversation(events);

    expect(state.nodes.map((n) => n.key)).toEqual(["b", "c", "d"]);
    expect(state.byKey.get("b")).toBe(0);
    expect(state.byKey.get("c")).toBe(1);
    expect(state.byKey.get("d")).toBe(2);
    expect(state.toasts.map((t) => t.message)).toEqual(["hello", "world"]);
    expect(state.navigate).toEqual({ href: "/dashboard", replace: undefined });
  });

  it("returns the empty initial state for an empty event list", () => {
    const state = replayConversation([]);
    expect(state.nodes).toEqual([]);
    expect(state.toasts).toEqual([]);
    expect(state.navigate).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/testing/replay.test.ts`
Expected: failure — `replay.ts` doesn't exist yet.

- [ ] **Step 3: Create `packages/react/src/testing/replay.ts`**

```ts
import { agentReducer, createInitialAgentState, type AgentState } from "../reducer.js";
import type { UIEvent } from "@kibadist/agentui-protocol";

/** Run a single UIEvent through `agentReducer`. Pure — returns a new state. */
export function pushEvent(state: AgentState, event: UIEvent): AgentState {
  return agentReducer(state, event);
}

/** Fold `agentReducer` over a sequence, starting from a fresh initial state. */
export function replayConversation(events: UIEvent[]): AgentState {
  let state = createInitialAgentState();
  for (const event of events) {
    state = agentReducer(state, event);
  }
  return state;
}
```

- [ ] **Step 4: Typecheck + run the new tests**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/testing/replay.test.ts`
Expected: typecheck clean, `3 passed`.

- [ ] **Step 5: Run the full suite — no regressions**

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/testing/replay.ts packages/react/test/testing/replay.test.ts
git commit -m "feat(react): add testing/replay — pushEvent + replayConversation"
```

---

## Task 2: `test-registry.tsx` + tests — Registry with marker fallback

**Files:**
- Create: `packages/react/src/testing/test-registry.tsx`
- Create: `packages/react/test/testing/test-registry.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `packages/react/test/testing/test-registry.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AgentRenderer, createInitialAgentState, type AgentState } from "../../src/index.js";
import { createTestRegistry } from "../../src/testing/test-registry.js";
import type { UINode } from "@kibadist/agentui-protocol";

afterEach(cleanup);

function makeState(nodes: UINode[]): AgentState {
  const byKey = new Map<string, number>();
  nodes.forEach((n, i) => byKey.set(n.key, i));
  return { ...createInitialAgentState(), nodes, byKey };
}

function Known({ label }: { label: string }) {
  return <span data-testid={`known-${label}`}>{label}</span>;
}

describe("createTestRegistry", () => {
  it("resolves known types to the supplied component", () => {
    const registry = createTestRegistry({ "known.kind": { component: Known } });
    const state = makeState([{ key: "k1", type: "known.kind", props: { label: "alpha" } }]);
    const { getByTestId } = render(<AgentRenderer state={state} registry={registry} />);
    expect(getByTestId("known-alpha")).toBeTruthy();
  });

  it("renders a marker for unregistered types with serialized props", () => {
    const registry = createTestRegistry({});
    const state = makeState([{ key: "k1", type: "mystery", props: { hello: "world" } }]);
    const { getByTestId } = render(<AgentRenderer state={state} registry={registry} />);
    const marker = getByTestId("test-marker-mystery");
    expect(marker.textContent).toContain("hello");
    expect(marker.textContent).toContain("world");
  });

  it("returns the same component reference for repeated lookups of an unknown type", () => {
    const registry = createTestRegistry({});
    const a = registry.get("repeat.type");
    const b = registry.get("repeat.type");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a!.component).toBe(b!.component);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/testing/test-registry.test.tsx`
Expected: failure — `test-registry.tsx` doesn't exist yet.

- [ ] **Step 3: Create `packages/react/src/testing/test-registry.tsx`**

```tsx
import { type ComponentType } from "react";
import { createRegistry, type ComponentSpec, type Registry } from "../registry.js";

// Module-scoped cache: same unknown type → same component reference across calls.
// Keeps React reconciliation stable when tests reuse a marker across rerenders.
const markerCache = new Map<string, ComponentType<Record<string, unknown>>>();

function getMarker(type: string): ComponentType<Record<string, unknown>> {
  const cached = markerCache.get(type);
  if (cached) return cached;
  const Marker = (props: Record<string, unknown>) => (
    <span data-testid={`test-marker-${type}`}>{JSON.stringify(props)}</span>
  );
  Marker.displayName = `TestMarker(${type})`;
  markerCache.set(type, Marker);
  return Marker;
}

/**
 * A Registry that stubs missing entries with a marker component rendering
 * `<span data-testid="test-marker-{type}">{JSON.stringify(props)}</span>`.
 * Known types resolve to the supplied component as usual.
 */
export function createTestRegistry(map: Record<string, ComponentSpec>): Registry {
  const base = createRegistry(map);
  return {
    get(type) {
      return base.get(type) ?? { component: getMarker(type) };
    },
    has() {
      return true;
    },
    types() {
      return base.types();
    },
  };
}
```

- [ ] **Step 4: Typecheck + run the new tests**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/testing/test-registry.test.tsx`
Expected: typecheck clean, `3 passed`.

- [ ] **Step 5: Run the full suite — no regressions**

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/testing/test-registry.tsx packages/react/test/testing/test-registry.test.tsx
git commit -m "feat(react): add testing/test-registry — Registry with marker fallback"
```

---

## Task 3: `mock-agent-stream.ts` + tests — hook + control surface

**Files:**
- Create: `packages/react/src/testing/mock-agent-stream.ts`
- Create: `packages/react/test/testing/mock-agent-stream.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `packages/react/test/testing/mock-agent-stream.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type {
  UIAppendEvent,
  UINavigateEvent,
  UIToastEvent,
} from "@kibadist/agentui-protocol";
import {
  AgentStateProvider,
  useAgentNodes,
} from "../../src/index.js";
import { createMockAgentStream } from "../../src/testing/mock-agent-stream.js";

afterEach(cleanup);

function appendEvent(key: string): UIAppendEvent {
  return { v: 1, id: `evt-a-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.append", node: { key, type: "test.node", props: {} } };
}
function toastEvent(message: string): UIToastEvent {
  return { v: 1, id: `evt-t-${message}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.toast", level: "info", message };
}
function navigateEvent(href: string): UINavigateEvent {
  return { v: 1, id: `evt-n-${href}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.navigate", href };
}

function NodesProbe() {
  const nodes = useAgentNodes();
  return <span data-testid="probe-nodes-count">{nodes.length}</span>;
}

describe("createMockAgentStream", () => {
  it("push() drives selector consumers via the provided store", () => {
    const mock = createMockAgentStream();

    const { getByTestId } = render(
      <AgentStateProvider store={mock.store}>
        <NodesProbe />
      </AgentStateProvider>,
    );
    expect(getByTestId("probe-nodes-count").textContent).toBe("0");

    act(() => {
      mock.push(appendEvent("a"));
      mock.push(appendEvent("b"));
    });

    expect(getByTestId("probe-nodes-count").textContent).toBe("2");
    expect(mock.state.nodes.map((n) => n.key)).toEqual(["a", "b"]);
  });

  it("hook() returns the same shape as useAgentStream and reacts to setStatus", () => {
    const mock = createMockAgentStream();

    function HookProbe() {
      const result = mock.hook();
      return (
        <>
          <span data-testid="probe-status">{result.status}</span>
          <span data-testid="probe-nodes">{result.state.nodes.length}</span>
          <span data-testid="probe-has-store">{result.store ? "yes" : "no"}</span>
        </>
      );
    }

    const { getByTestId } = render(<HookProbe />);
    expect(getByTestId("probe-status").textContent).toBe("idle");
    expect(getByTestId("probe-nodes").textContent).toBe("0");
    expect(getByTestId("probe-has-store").textContent).toBe("yes");

    act(() => {
      mock.setStatus("open");
    });
    expect(getByTestId("probe-status").textContent).toBe("open");

    act(() => {
      mock.push(appendEvent("a"));
    });
    expect(getByTestId("probe-nodes").textContent).toBe("1");
  });

  it("history records every dispatched action in order (push, dispatchInternal, reset)", () => {
    const mock = createMockAgentStream();

    mock.push(appendEvent("a"));
    mock.push(toastEvent("hello"));
    mock.dispatchInternal({ op: "__reset__" });
    mock.push(navigateEvent("/foo"));

    expect(mock.history).toHaveLength(4);
    expect(mock.history[0].op).toBe("ui.append");
    expect(mock.history[1].op).toBe("ui.toast");
    expect(mock.history[2].op).toBe("__reset__");
    expect(mock.history[3].op).toBe("ui.navigate");
  });

  it("state is a live getter — reads outside React reflect current state", () => {
    const mock = createMockAgentStream();
    expect(mock.state.nodes).toHaveLength(0);

    mock.push(appendEvent("a"));
    expect(mock.state.nodes).toHaveLength(1);

    mock.reset();
    expect(mock.state.nodes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/testing/mock-agent-stream.test.tsx`
Expected: failure — `mock-agent-stream.ts` doesn't exist yet.

- [ ] **Step 3: Create `packages/react/src/testing/mock-agent-stream.ts`**

```ts
import { useSyncExternalStore } from "react";
import { createAgentStore, type AgentStore } from "../store.js";
import { createInitialAgentState, type AgentAction, type AgentState } from "../reducer.js";
import type { UIEvent } from "@kibadist/agentui-protocol";
import type { StreamStatus, UseAgentStreamResult } from "../use-agent-stream.js";

export interface MockAgentStream {
  /** Drop-in for `useAgentStream`. Call inside a React render context. */
  hook: () => UseAgentStreamResult;
  /** The underlying AgentStore. Wire into `<AgentStateProvider store={...}>`. */
  store: AgentStore;
  /** Simulate inbound SSE (typed to UIEvent — wire-level events only). */
  push: (event: UIEvent) => void;
  /** Reducer-level injection. Accepts `AgentAction` (UIEvent | AgentResetAction). */
  dispatchInternal: (action: AgentAction) => void;
  /** Drive the StreamStatus subscribers. */
  setStatus: (status: StreamStatus) => void;
  /** Shorthand for `store.reset()`. */
  reset: () => void;
  /** Live snapshot — readable in assertions (getter; always current). */
  readonly state: AgentState;
  /** Recorded actions in dispatch order. Mutated in place. */
  history: AgentAction[];
}

export function createMockAgentStream(initial?: Partial<AgentState>): MockAgentStream {
  const store = createAgentStore({ ...createInitialAgentState(), ...initial });
  const history: AgentAction[] = [];
  let currentStatus: StreamStatus = "idle";
  const statusListeners = new Set<() => void>();

  // Wrap send to record dispatch history. push() and dispatchInternal() both
  // route through store.send, and store.reset() internally sends "__reset__",
  // so this captures every action consistently.
  const originalSend = store.send;
  store.send = (action: AgentAction) => {
    history.push(action);
    originalSend(action);
  };

  const hook = (): UseAgentStreamResult => {
    const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
    const status = useSyncExternalStore(
      (l) => {
        statusListeners.add(l);
        return () => {
          statusListeners.delete(l);
        };
      },
      () => currentStatus,
      () => currentStatus,
    );
    return {
      state,
      status,
      store,
      close: () => {
        currentStatus = "closed";
        statusListeners.forEach((l) => l());
      },
      reset: () => store.reset(),
      dispatch: (event: UIEvent) => store.send(event),
    };
  };

  return {
    hook,
    store,
    push: (event: UIEvent) => store.send(event),
    dispatchInternal: (action: AgentAction) => store.send(action),
    setStatus: (status: StreamStatus) => {
      currentStatus = status;
      statusListeners.forEach((l) => l());
    },
    reset: () => store.reset(),
    get state() {
      return store.getState();
    },
    history,
  };
}
```

- [ ] **Step 4: Typecheck + run the new tests**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/testing/mock-agent-stream.test.tsx`
Expected: typecheck clean, `4 passed`.

- [ ] **Step 5: Run the full suite — no regressions**

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/testing/mock-agent-stream.ts packages/react/test/testing/mock-agent-stream.test.tsx
git commit -m "feat(react): add testing/mock-agent-stream — createMockAgentStream"
```

---

## Task 4: Subpath wiring — `testing/index.ts` + package.json `exports`

**Files:**
- Create: `packages/react/src/testing/index.ts`
- Modify: `packages/react/package.json` (add `"./testing"` to `exports`)

- [ ] **Step 1: Create `packages/react/src/testing/index.ts`**

```ts
export { pushEvent, replayConversation } from "./replay.js";
export { createTestRegistry } from "./test-registry.js";
export { createMockAgentStream } from "./mock-agent-stream.js";
export type { MockAgentStream } from "./mock-agent-stream.js";
```

- [ ] **Step 2: Edit `packages/react/package.json`**

Find this block (around lines 19-25):

```jsonc
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
```

Replace with:

```jsonc
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "import": "./dist/testing/index.js",
      "default": "./dist/testing/index.js"
    }
  },
```

- [ ] **Step 3: Build the package and verify the output files exist**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react build`
Expected: build succeeds with no errors.

Run: `ls /Users/max/agentui/packages/react/dist/testing/`
Expected output includes: `index.d.ts`, `index.js`, `mock-agent-stream.d.ts`, `mock-agent-stream.js`, `replay.d.ts`, `replay.js`, `test-registry.d.ts`, `test-registry.js` (plus their `.d.ts.map` / `.js.map` siblings).

If any of those four `*.d.ts` files are missing, the typecheck/build step failed and needs investigation before commit.

- [ ] **Step 4: Typecheck once more — full package**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck`
Expected: clean.

- [ ] **Step 5: Run the full test suite**

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/testing/index.ts packages/react/package.json
git commit -m "feat(react): expose /testing subpath in package exports"
```

---

## Task 5: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md` (append to existing `0.4.0`)
- Modify: `README.md` (subsection under "Granular state selectors")

- [ ] **Step 1: Edit `CHANGELOG.md`**

Find the last bullet in the `0.4.0` → `### Added — @kibadist/agentui-react` list. It is:

```md
- **`createAgentStore()`** factory exported for tests and non-stream-driven hosts. Implements `{ getState, subscribe, send, reset }` — a minimal `Subscribable<AgentState>`.
```

After it, insert this new bullet:

```md
- **Testing subpath** (`@kibadist/agentui-react/testing`). Ships `createMockAgentStream(initial?)` (hook + control surface: `push`, `dispatchInternal`, `setStatus`, `reset`, `state` getter, `history`), pure `pushEvent` / `replayConversation` reducer helpers, and `createTestRegistry` (a Registry that stubs missing types with marker components for assertions). No runtime cost — vitest stays a devDep.
```

- [ ] **Step 2: Edit `README.md`**

Find the closing line of the "Granular state selectors" subsection:

```md
`useAgentStream().state` keeps working — selectors are additive. The detailing-app pattern of splitting "stream-hot" and "session-stable" contexts collapses into a single `<AgentStateProvider>`.
```

BEFORE the next `---` separator that follows it, insert a new subsection (preserve a blank line above and below):

```md

### Testing helpers

`@kibadist/agentui-react/testing` ships drop-in mocks for vitest setups:

```tsx
import { createMockAgentStream } from "@kibadist/agentui-react/testing";
import { AgentStateProvider, useAgentNodes } from "@kibadist/agentui-react";

const mock = createMockAgentStream();

render(
  <AgentStateProvider store={mock.store}>
    <YourComponent />     {/* anywhere inside: useAgentNodes(), etc. */}
  </AgentStateProvider>,
);

act(() => {
  mock.push({ v: 1, op: "ui.append", node: { key: "a", type: "card", props: {} }, id: "e1", ts: "...", sessionId: "s" });
  mock.setStatus("open");
});

expect(mock.state.nodes).toHaveLength(1);
expect(mock.history).toHaveLength(1);
```

Also exposes `pushEvent(state, event)` and `replayConversation(events)` for pure reducer-level tests, and `createTestRegistry(map)` (a Registry that renders `<span data-testid="test-marker-{type}">` for unregistered types).
```

- [ ] **Step 3: Run the full suite as a smoke check**

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/max/agentui
git add CHANGELOG.md README.md
git commit -m "docs: document /testing subpath helpers (0.4.0)"
```

---

## Verification — done when

- [ ] `pnpm test` passes — should include the three new test files under `packages/react/test/testing/` (replay 3, test-registry 3, mock-agent-stream 4 = 10 new tests; total 49).
- [ ] `pnpm --filter @kibadist/agentui-react typecheck` clean.
- [ ] `pnpm --filter @kibadist/agentui-react build` produces `dist/testing/index.{js,d.ts}` plus per-file outputs.
- [ ] `git log --oneline` shows the five task commits in order.
- [ ] No version bumps in `package.json` files. Release script handles versioning.
- [ ] DET-137 transitioned to "Done" in Linear after the last commit lands.

## Out of scope (restated from spec)

- Module-mock automation (no `installMockReactPackage(vi)` helper).
- Storybook adapter.
- Server / NestJS-side test helpers (separate ticket if needed).
- Adding `vitest` as a runtime dep — it stays at the workspace root devDeps.
