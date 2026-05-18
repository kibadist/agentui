# AgentRenderer Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five additive props to `AgentRenderer` — `range`, `filter`, `hiddenTypes`, `errorFallback`, `nodeWrapper` — so consumers stop wrapping the renderer for slicing, error containment, and animation mounts.

**Architecture:** Single-pass derivation inside `AgentRenderer`. Pipeline: `slot → range → filter → hiddenTypes`. ErrorBoundary is an internal class component that only mounts when `errorFallback` is supplied (zero overhead by default). `nodeWrapper` composes **outside** the ErrorBoundary so animation wrappers stay mounted through inner throws. Per-node key sits on a `React.Fragment` so it's stable regardless of which wrappers are present.

**Tech Stack:** TypeScript strict, React 19, Vitest + jsdom + @testing-library/react. Edit `packages/react/src/renderer.tsx`; new test file `packages/react/test/renderer.test.tsx`; export `AgentRendererProps` from `packages/react/src/index.ts`.

**Spec:** [docs/superpowers/specs/2026-05-18-renderer-ergonomics-design.md](../specs/2026-05-18-renderer-ergonomics-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/react/src/renderer.tsx` | Modify (replace contents) | All pipeline logic; internal `NodeErrorBoundary` class |
| `packages/react/src/index.ts` | Modify (one new line) | Export `AgentRendererProps` type for consumer composition |
| `packages/react/test/renderer.test.tsx` | Create | Six tests: baseline + one per new prop |
| `CHANGELOG.md` | Modify (add 0.4.0 section above 0.3.1) | Document the additive surface |
| `README.md` | Modify (add `hiddenTypes` example under "Supported UI Operations") | First-touch use case |

The renderer file stays small (~110 lines after all changes). Per-prop tasks below build it up incrementally with TDD cycles. Each task is one test → implementation → verify → commit.

---

## Conventions used throughout this plan

- All commands run from the repo root: `/Users/max/agentui`.
- Test runner: `pnpm test` (one-shot) or scope to one file: `pnpm test packages/react/test/renderer.test.tsx`.
- Workspace builds: `pnpm --filter @kibadist/agentui-react typecheck` after each renderer edit.
- All tests use these helpers, defined once in the test file:

```tsx
import type { UINode } from "@kibadist/agentui-protocol";
import type { AgentState } from "../src/index.js";

function makeNode(key: string, type = "test.box", props: Record<string, unknown> = {}): UINode {
  return { key, type, props };
}

function makeState(nodes: UINode[]): AgentState {
  const byKey = new Map<string, number>();
  nodes.forEach((n, i) => byKey.set(n.key, i));
  return { nodes, byKey, toasts: [], navigate: null };
}
```

---

## Task 1: Scaffold renderer test file with baseline test

**Files:**
- Create: `packages/react/test/renderer.test.tsx`

This locks down current behavior with one passing test before any renderer edits, so later tasks can detect regressions immediately.

- [ ] **Step 1: Write the baseline test file**

Create `packages/react/test/renderer.test.tsx` with this content:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { UINode } from "@kibadist/agentui-protocol";
import { AgentRenderer, createRegistry } from "../src/index.js";
import type { AgentState } from "../src/index.js";

function makeNode(
  key: string,
  type = "test.box",
  props: Record<string, unknown> = {},
): UINode {
  return { key, type, props };
}

function makeState(nodes: UINode[]): AgentState {
  const byKey = new Map<string, number>();
  nodes.forEach((n, i) => byKey.set(n.key, i));
  return { nodes, byKey, toasts: [], navigate: null };
}

function Box({ label }: { label: string }) {
  return <span data-testid={`box-${label}`}>{label}</span>;
}

const registry = createRegistry({
  "test.box": { component: Box },
});

describe("AgentRenderer — baseline (no new props)", () => {
  it("renders every node in state.nodes order", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
      makeNode("c", "test.box", { label: "c" }),
    ]);
    const { getAllByTestId } = render(
      <AgentRenderer state={state} registry={registry} />,
    );
    const ids = getAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual(["box-a", "box-b", "box-c"]);
  });
});
```

- [ ] **Step 2: Run the test, confirm it passes against the current renderer**

Run: `pnpm test packages/react/test/renderer.test.tsx`
Expected: `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add packages/react/test/renderer.test.tsx
git commit -m "test(react): scaffold AgentRenderer baseline test"
```

---

## Task 2: `range` prop (TDD cycle)

**Files:**
- Modify: `packages/react/test/renderer.test.tsx` (add `describe("range")` block)
- Modify: `packages/react/src/renderer.tsx` (add `range` prop, half-open clamped slice)

- [ ] **Step 1: Write the failing test**

Append this block to `packages/react/test/renderer.test.tsx`, after the baseline `describe`:

```tsx
describe("AgentRenderer — range", () => {
  it("renders only indices in the half-open [start, end) window", () => {
    const state = makeState(
      Array.from({ length: 7 }, (_, i) => makeNode(`k${i}`, "test.box", { label: `${i}` })),
    );
    const { queryAllByTestId } = render(
      <AgentRenderer state={state} registry={registry} range={{ start: 2, end: 5 }} />,
    );
    const ids = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual(["box-2", "box-3", "box-4"]);
  });

  it("clamps out-of-bounds range to the array length", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
    ]);
    const { queryAllByTestId } = render(
      <AgentRenderer state={state} registry={registry} range={{ start: -3, end: 999 }} />,
    );
    expect(queryAllByTestId(/^box-/)).toHaveLength(2);
  });

  it("treats start >= end as empty", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
    ]);
    const { queryAllByTestId } = render(
      <AgentRenderer state={state} registry={registry} range={{ start: 1, end: 1 }} />,
    );
    expect(queryAllByTestId(/^box-/)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm test packages/react/test/renderer.test.tsx`
Expected: 3 failures with "Unknown prop `range`" or similar TS / type errors at the test-render call site. (Vitest will surface either way.)

- [ ] **Step 3: Implement — replace `packages/react/src/renderer.tsx` entirely with this**

```tsx
import { createElement, Fragment, type ReactNode } from "react";
import type { UINode } from "@kibadist/agentui-protocol";
import type { Registry } from "./registry.js";
import type { AgentState } from "./reducer.js";

export interface AgentRendererProps {
  state: AgentState;
  registry: Registry;
  /** Only render nodes matching this slot (undefined = all). */
  slot?: string;
  /** Rendered when a node type is not in the registry. */
  fallback?: (node: UINode) => ReactNode;
  /** Half-open slice over the post-slot list. Missing bounds default to 0 / length. */
  range?: { start?: number; end?: number };
}

export function AgentRenderer({
  state,
  registry,
  slot,
  fallback,
  range,
}: AgentRendererProps) {
  const slotted = slot ? state.nodes.filter((n) => n.slot === slot) : state.nodes;
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min(slotted.length, range?.end ?? slotted.length);

  const rendered: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    const node = slotted[i];
    const el = renderOne(node, registry, fallback);
    if (el === null) continue;
    rendered.push(createElement(Fragment, { key: node.key }, el));
  }

  return <>{rendered}</>;
}

function renderOne(
  node: UINode,
  registry: Registry,
  fallback: ((node: UINode) => ReactNode) | undefined,
): ReactNode {
  const spec = registry.get(node.type);
  if (!spec) {
    if (fallback) return fallback(node);
    if (typeof globalThis !== "undefined" && (globalThis as any).__DEV__ !== false) {
      console.warn(`[agentui] Unknown component type: "${node.type}"`);
    }
    return null;
  }

  if (spec.propsSchema) {
    const result = spec.propsSchema.safeParse(node.props);
    if (!result.success) {
      if (typeof globalThis !== "undefined" && (globalThis as any).__DEV__ !== false) {
        console.warn(
          `[agentui] Props validation failed for "${node.type}" (key="${node.key}"):`,
          result.error.message,
        );
      }
      return null;
    }
  }

  return createElement(spec.component, node.props);
}
```

Note: the per-node `key` moves from the component element onto a `React.Fragment`. This is invisible in the DOM and keeps key placement stable across all later tasks that add wrappers.

- [ ] **Step 4: Typecheck the react package**

Run: `pnpm --filter @kibadist/agentui-react typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full renderer test file, all pass**

Run: `pnpm test packages/react/test/renderer.test.tsx`
Expected: `4 passed` (baseline + 3 range tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/renderer.tsx packages/react/test/renderer.test.tsx
git commit -m "feat(react): add range prop to AgentRenderer"
```

---

## Task 3: `filter` prop (TDD cycle)

**Files:**
- Modify: `packages/react/test/renderer.test.tsx` (add `describe("filter")` block)
- Modify: `packages/react/src/renderer.tsx` (add `filter` to props + apply after range)

- [ ] **Step 1: Write the failing test**

Append to the test file:

```tsx
describe("AgentRenderer — filter", () => {
  it("calls filter with (node, index) where index is post-slot pre-range", () => {
    const state = makeState(
      Array.from({ length: 5 }, (_, i) => makeNode(`k${i}`, "test.box", { label: `${i}` })),
    );
    const calls: Array<{ key: string; index: number }> = [];
    const filter = (node: UINode, index: number) => {
      calls.push({ key: node.key, index });
      return true;
    };
    render(
      <AgentRenderer
        state={state}
        registry={registry}
        range={{ start: 1, end: 4 }}
        filter={filter}
      />,
    );
    // Indices passed must be the original positions in state.nodes, not 0..n-1
    expect(calls).toEqual([
      { key: "k1", index: 1 },
      { key: "k2", index: 2 },
      { key: "k3", index: 3 },
    ]);
  });

  it("skips nodes where filter returns false", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
      makeNode("c", "test.box", { label: "c" }),
    ]);
    const { queryAllByTestId } = render(
      <AgentRenderer
        state={state}
        registry={registry}
        filter={(n) => n.key !== "b"}
      />,
    );
    const ids = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual(["box-a", "box-c"]);
  });
});
```

- [ ] **Step 2: Run, confirm new tests fail**

Run: `pnpm test packages/react/test/renderer.test.tsx`
Expected: 2 new failures (`filter` is not a known prop).

- [ ] **Step 3: Edit renderer.tsx — add the prop and apply it**

Edit `packages/react/src/renderer.tsx`:

Add `filter` to the interface:

```tsx
  /** Half-open slice over the post-slot list. Missing bounds default to 0 / length. */
  range?: { start?: number; end?: number };
  /**
   * Predicate run after range. Receives the node and its index in the
   * post-slot (pre-range) array — stable as `range` changes.
   */
  filter?: (node: UINode, index: number) => boolean;
```

Add `filter` to the destructure:

```tsx
export function AgentRenderer({
  state,
  registry,
  slot,
  fallback,
  range,
  filter,
}: AgentRendererProps) {
```

Add the filter call inside the loop, right after the `const node = slotted[i];` line:

```tsx
    const node = slotted[i];
    if (filter && !filter(node, i)) continue;
    const el = renderOne(node, registry, fallback);
```

- [ ] **Step 4: Typecheck and run tests**

Run: `pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/renderer.test.tsx`
Expected: typecheck clean, `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/renderer.tsx packages/react/test/renderer.test.tsx
git commit -m "feat(react): add filter prop to AgentRenderer"
```

---

## Task 4: `hiddenTypes` prop (TDD cycle)

**Files:**
- Modify: `packages/react/test/renderer.test.tsx` (add `describe("hiddenTypes")` block)
- Modify: `packages/react/src/renderer.tsx` (add `hiddenTypes`, applied after filter)

- [ ] **Step 1: Write the failing test**

Append to the test file:

```tsx
describe("AgentRenderer — hiddenTypes", () => {
  it("excludes nodes whose type is in the set", () => {
    const localRegistry = createRegistry({
      "test.box": { component: Box },
      "panel-patch": { component: () => <span data-testid="patch">patch</span> },
    });
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("p", "panel-patch"),
      makeNode("c", "test.box", { label: "c" }),
    ]);
    const { queryAllByTestId } = render(
      <AgentRenderer
        state={state}
        registry={localRegistry}
        hiddenTypes={["panel-patch"]}
      />,
    );
    const boxes = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(boxes).toEqual(["box-a", "box-c"]);
    expect(queryAllByTestId("patch")).toHaveLength(0);
  });

  it("hiddenTypes is applied AFTER filter (hard exclusion)", () => {
    const localRegistry = createRegistry({
      "test.box": { component: Box },
      "panel-patch": { component: () => <span data-testid="patch">patch</span> },
    });
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("p", "panel-patch"),
    ]);
    // Filter tries to re-admit panel-patch; hiddenTypes still excludes it.
    const { queryAllByTestId } = render(
      <AgentRenderer
        state={state}
        registry={localRegistry}
        filter={() => true}
        hiddenTypes={["panel-patch"]}
      />,
    );
    expect(queryAllByTestId("patch")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, confirm new tests fail**

Run: `pnpm test packages/react/test/renderer.test.tsx`
Expected: 2 new failures.

- [ ] **Step 3: Edit renderer.tsx — add the prop and apply it**

Add to the interface (after `filter`):

```tsx
  /** Convenience exclusion set. Applied last; cannot be bypassed by `filter`. */
  hiddenTypes?: ReadonlyArray<string>;
```

Add to the destructure:

```tsx
  hiddenTypes,
```

Add a hidden set just before the loop:

```tsx
  const hiddenSet =
    hiddenTypes && hiddenTypes.length > 0 ? new Set(hiddenTypes) : null;

  const rendered: ReactNode[] = [];
  for (let i = start; i < end; i++) {
```

Add the exclusion check after the filter call:

```tsx
    const node = slotted[i];
    if (filter && !filter(node, i)) continue;
    if (hiddenSet && hiddenSet.has(node.type)) continue;
    const el = renderOne(node, registry, fallback);
```

- [ ] **Step 4: Typecheck and run tests**

Run: `pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/renderer.test.tsx`
Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/renderer.tsx packages/react/test/renderer.test.tsx
git commit -m "feat(react): add hiddenTypes prop to AgentRenderer"
```

---

## Task 5: `errorFallback` prop + internal NodeErrorBoundary (TDD cycle)

**Files:**
- Modify: `packages/react/test/renderer.test.tsx` (add `describe("errorFallback")` block)
- Modify: `packages/react/src/renderer.tsx` (add `NodeErrorBoundary` class, wire `errorFallback`)

- [ ] **Step 1: Write the failing test**

Append to the test file:

```tsx
describe("AgentRenderer — errorFallback", () => {
  it("renders the fallback when a component throws; siblings unaffected", () => {
    // Silence the React error log that fires when an EB catches.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Throwing({ label }: { label: string }) {
      throw new Error(`boom-${label}`);
    }
    const localRegistry = createRegistry({
      "test.box": { component: Box },
      "test.throwing": { component: Throwing },
    });

    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("bad", "test.throwing", { label: "x" }),
      makeNode("c", "test.box", { label: "c" }),
    ]);

    const { queryAllByTestId, queryByTestId } = render(
      <AgentRenderer
        state={state}
        registry={localRegistry}
        errorFallback={(err, node) => (
          <span data-testid={`err-${node.key}`}>{err.message}</span>
        )}
      />,
    );

    const boxes = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(boxes).toEqual(["box-a", "box-c"]);
    expect(queryByTestId("err-bad")?.textContent).toBe("boom-x");

    errSpy.mockRestore();
  });
});
```

Add the `vi` import at the top of the test file if missing:

```tsx
import { describe, it, expect, vi } from "vitest";
```

- [ ] **Step 2: Run, confirm test fails**

Run: `pnpm test packages/react/test/renderer.test.tsx`
Expected: failure (the throw propagates and crashes the render; the test will see an unhandled error or no `err-bad` element).

- [ ] **Step 3: Edit renderer.tsx — add NodeErrorBoundary and wire it**

Update the imports at the top of `packages/react/src/renderer.tsx`:

```tsx
import { Component, createElement, Fragment, type ReactNode } from "react";
```

Add this class component below the imports, above `AgentRenderer`:

```tsx
interface NodeErrorBoundaryProps {
  fallback: (err: Error) => ReactNode;
  children: ReactNode;
}
interface NodeErrorBoundaryState {
  error: Error | null;
}
class NodeErrorBoundary extends Component<
  NodeErrorBoundaryProps,
  NodeErrorBoundaryState
> {
  state: NodeErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): NodeErrorBoundaryState {
    return { error };
  }
  render(): ReactNode {
    return this.state.error
      ? this.props.fallback(this.state.error)
      : this.props.children;
  }
}
```

Add `errorFallback` to the interface (after `hiddenTypes`):

```tsx
  /**
   * If set, each rendered node is wrapped in an internal error boundary
   * that invokes this on a render error. If omitted, errors propagate
   * (current behavior — no boundary, no reconciliation overhead).
   */
  errorFallback?: (err: Error, node: UINode) => ReactNode;
```

Add to the destructure:

```tsx
  errorFallback,
```

In the loop body, replace this single line:

```tsx
    rendered.push(createElement(Fragment, { key: node.key }, el));
```

…with this block (the `const el = ...` and `if (el === null) continue;` lines above it stay as-is):

```tsx
    const guarded = errorFallback
      ? createElement(
          NodeErrorBoundary,
          { fallback: (err: Error) => errorFallback(err, node) },
          el,
        )
      : el;

    rendered.push(createElement(Fragment, { key: node.key }, guarded));
```

- [ ] **Step 4: Typecheck and run tests**

Run: `pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/renderer.test.tsx`
Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/renderer.tsx packages/react/test/renderer.test.tsx
git commit -m "feat(react): add errorFallback + internal NodeErrorBoundary to AgentRenderer"
```

---

## Task 6: `nodeWrapper` prop + composition order test (TDD cycle)

**Files:**
- Modify: `packages/react/test/renderer.test.tsx` (add `describe("nodeWrapper")` block with a composition-order test)
- Modify: `packages/react/src/renderer.tsx` (add `nodeWrapper`; apply outside errorFallback)

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```tsx
describe("AgentRenderer — nodeWrapper", () => {
  it("wraps every rendered node with the supplied wrapper", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
    ]);
    const calls: Array<string> = [];
    const { container, queryAllByTestId } = render(
      <AgentRenderer
        state={state}
        registry={registry}
        nodeWrapper={(node, children) => {
          calls.push(node.key);
          return <div data-wrap={node.key}>{children}</div>;
        }}
      />,
    );
    expect(calls).toEqual(["a", "b"]);
    expect(container.querySelector('[data-wrap="a"] [data-testid="box-a"]')).not.toBeNull();
    expect(container.querySelector('[data-wrap="b"] [data-testid="box-b"]')).not.toBeNull();
    expect(queryAllByTestId(/^box-/)).toHaveLength(2);
  });

  it("composition: nodeWrapper sits OUTSIDE the error boundary", () => {
    // When the inner component throws, the wrapper element should still be
    // in the DOM (so framer-motion / AnimatePresence keys stay tracked) and
    // the fallback content should sit inside that wrapper.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Throwing() {
      throw new Error("inner-boom");
    }
    const localRegistry = createRegistry({
      "test.throwing": { component: Throwing },
    });

    const state = makeState([makeNode("bad", "test.throwing")]);

    const { container } = render(
      <AgentRenderer
        state={state}
        registry={localRegistry}
        errorFallback={(err) => <span data-testid="fallback">{err.message}</span>}
        nodeWrapper={(node, children) => <div data-wrap={node.key}>{children}</div>}
      />,
    );

    const wrap = container.querySelector('[data-wrap="bad"]');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('[data-testid="fallback"]')?.textContent).toBe("inner-boom");

    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run, confirm new tests fail**

Run: `pnpm test packages/react/test/renderer.test.tsx`
Expected: 2 new failures.

- [ ] **Step 3: Edit renderer.tsx — add `nodeWrapper` prop, apply outside boundary**

Add to the interface (after `errorFallback`):

```tsx
  /**
   * Wraps each rendered node. Useful for `<AnimatePresence>`-style mount/unmount
   * tracking. The wrapper is the outermost layer per node (sits outside the
   * error boundary), so it remains mounted even if the inner component throws.
   */
  nodeWrapper?: (node: UINode, children: ReactNode) => ReactNode;
```

Add to the destructure:

```tsx
  nodeWrapper,
```

Replace the `rendered.push(...)` line at the end of the loop body with this two-step wrap:

```tsx
    const guarded = errorFallback
      ? createElement(
          NodeErrorBoundary,
          { fallback: (err: Error) => errorFallback(err, node) },
          el,
        )
      : el;

    const wrapped = nodeWrapper ? nodeWrapper(node, guarded) : guarded;

    rendered.push(createElement(Fragment, { key: node.key }, wrapped));
```

- [ ] **Step 4: Typecheck and run tests**

Run: `pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/renderer.test.tsx`
Expected: `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/renderer.tsx packages/react/test/renderer.test.tsx
git commit -m "feat(react): add nodeWrapper prop to AgentRenderer (outer to error boundary)"
```

---

## Task 7: Export `AgentRendererProps` type from the package entrypoint

**Files:**
- Modify: `packages/react/src/index.ts`

Consumers wrapping `AgentRenderer` (e.g., to bake in default props) need this type. It exists but isn't exported.

- [ ] **Step 1: Edit `packages/react/src/index.ts`**

Find this line:

```ts
export { AgentRenderer } from "./renderer.js";
```

Replace it with:

```ts
export { AgentRenderer } from "./renderer.js";
export type { AgentRendererProps } from "./renderer.js";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kibadist/agentui-react typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all test files pass (renderer + reducer + use-agent-stream + validate).

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/index.ts
git commit -m "feat(react): export AgentRendererProps type"
```

---

## Task 8: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md` (add `0.4.0` section above the `0.3.1` entry)
- Modify: `README.md` (extend the "Supported UI Operations" area with a small subsection)

- [ ] **Step 1: Edit `CHANGELOG.md` — insert this block immediately below the `# Changelog` heading and its lead-in paragraph, ABOVE the existing `## 0.3.1` section**

```md
## 0.4.0

### Added — `@kibadist/agentui-react`

- `AgentRenderer` gains five additive props: `range`, `filter`, `hiddenTypes`, `errorFallback`, `nodeWrapper`. Composition order is `slot → range → filter → hiddenTypes`. All five default to no-op — callers that don't pass them see identical behavior to `0.3.x`.
  - Replaces hand-rolled `SlicedAgentRenderer` wrappers, per-node `<ErrorBoundary>` wrapping, and ad-hoc `hiddenTypes` filtering in consumer code.
- `AgentRendererProps` type is now exported from `@kibadist/agentui-react` for consumers composing on top of the renderer.

### Behavior

- The internal error boundary only attaches when `errorFallback` is set — no reconciliation overhead for consumers who don't use it.
- `nodeWrapper` is the outermost layer per node; it stays mounted even when the inner component throws and is caught by `errorFallback` (lets `<AnimatePresence>`-style wrappers track keys cleanly).
- Per-node React keys are now placed on an invisible `React.Fragment` for consistency across all wrapper combinations. No DOM impact.

```

- [ ] **Step 2: Edit `README.md` — extend the "Supported UI Operations" area**

In `/Users/max/agentui/README.md`, after the existing "Resetting a conversation" subsection and BEFORE the `---` separator that introduces "Example Prompts", insert this new subsection:

```md
### Renderer: range, filter, hiddenTypes, errorFallback, nodeWrapper

`AgentRenderer` accepts five optional props for slicing, hiding, error containment, and wrapping (e.g., for animation):

```tsx
<AgentRenderer
  state={state}
  registry={registry}
  range={{ start: lastSeenIndex, end: state.nodes.length }}   // paginate
  hiddenTypes={['panel-patch']}                               // hide structural nodes
  errorFallback={(err, node) => <ErrorCard message={err.message} nodeKey={node.key} />}
  nodeWrapper={(node, children) => (
    <motion.div key={node.key} layout>{children}</motion.div>
  )}
/>
```

Composition order is `slot → range → filter → hiddenTypes`. All five default to no-op, so existing call sites need no changes.
```

- [ ] **Step 3: Run the full test suite once more as a smoke check**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: document AgentRenderer ergonomics (0.4.0)"
```

---

## Verification — done when

- [ ] `pnpm test` passes (11+ renderer tests, plus all existing reducer/use-agent-stream/validate suites).
- [ ] `pnpm typecheck` (or `pnpm --filter @kibadist/agentui-react typecheck`) is clean.
- [ ] `pnpm build` builds the react package without errors.
- [ ] `git log --oneline` shows the eight task commits in order.
- [ ] No version bump in `package.json` files yet — versioning is done by the release script (`./scripts/bump-and-publish.sh minor`) which is a separate step the user runs when ready.

## Out of scope (deliberate, restated)

- Animation primitives.
- `propsSchema` failure handling changes.
- Lifting the pipeline into a standalone hook (belongs in DET-136).
- Publishing to npm — leave the version at `0.3.1` and let the release script handle the minor bump.
