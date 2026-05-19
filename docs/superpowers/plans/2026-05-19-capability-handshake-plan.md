# Capability Handshake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `session.init` wire event carrying `{ nodeTypes, actions, permissions }`. Store the declaration in reducer state. Gate `AgentRenderer` on `ComponentSpec.requires` against `state.capabilities.permissions`. Expose `useCapabilities()` for host-level UI gating.

**Architecture:** Four layers in lockstep:
1. **protocol** — new `SessionInitEvent` interface; widen `AgentWireEvent`.
2. **validate** — `sessionInitSchema`; add to `agentWireEventSchema` union.
3. **react reducer** — `AgentState.capabilities` with `declared: boolean` + three Sets; `session.init` case replaces (not merges).
4. **react renderer + hook** — `permissionFallback` prop on `AgentRenderer`; new `useCapabilities` hook reading from the agent-state context.

**Migration:** Additive. Without a `session.init` event, `declared === false` and the renderer skips permission gating (today's behavior).

**Version target:** rolls into 0.8.0 alongside DET-151 and DET-152.

---

## File Structure

**New:**
- `packages/react/src/use-capabilities.ts`
- `packages/validate/test/session-init.test.ts`
- `packages/react/test/reducer-capabilities.test.ts`
- `packages/react/test/renderer-permissions.test.tsx`
- `packages/react/test/use-capabilities.test.tsx`

**Modified:**
- `packages/protocol/src/index.ts`
- `packages/validate/src/schemas.ts`
- `packages/react/src/reducer.ts`
- `packages/react/src/renderer.tsx`
- `packages/react/src/index.ts`
- `README.md` / `CHANGELOG.md`

---

## Task 1: Protocol type

**Files:**
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1:** Edit `packages/protocol/src/index.ts`. Find the `SessionMetaEvent` block (around line 239). After it, add:

```ts
export interface SessionInitEvent extends BaseEvent {
  op: "session.init";
  capabilities: {
    nodeTypes: string[];
    actions: string[];
    permissions: string[];
  };
}
```

Find the `AgentWireEvent` union (around line 251) and add `SessionInitEvent` as the last member:

```ts
export type AgentWireEvent =
  | UIEvent
  | ToolEvent
  | ReasoningEvent
  | OptimisticEvent
  | SessionMetaEvent
  | SessionInitEvent;
```

- [ ] **Step 2:** Run typecheck:
```bash
pnpm typecheck
```
Likely passes (no consumer yet). If `reducer.ts` complains about exhaustive switch handling on `AgentAction` not including `session.init`, that's expected and Task 3 fixes it. For now: ignore — TypeScript will be permissive since the reducer handles the default case.

Actually verify: if typecheck fails because the reducer's switch is exhaustive, add a temporary `case "session.init": return state;` early-return placeholder so typecheck stays clean. Task 3 will replace it with the real handler.

- [ ] **Step 3:** Commit:
```bash
git add packages/protocol/src/index.ts packages/react/src/reducer.ts
git commit -m "feat(protocol): add SessionInitEvent (DET-153)"
```

(The reducer is in the `git add` list in case you needed the temporary placeholder.)

---

## Task 2: Validate schema

**Files:**
- Modify: `packages/validate/src/schemas.ts`
- Create: `packages/validate/test/session-init.test.ts`

- [ ] **Step 1: Write failing tests** at `packages/validate/test/session-init.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { agentWireEventSchema } from "../src/schemas.js";

const base = {
  v: 1 as const,
  id: "e1",
  ts: "2026-05-19T00:00:00Z",
  sessionId: "s1",
};

describe("session.init schema", () => {
  it("accepts a valid event", () => {
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
      capabilities: {
        nodeTypes: ["Card", "Quote"],
        actions: ["purchase.confirm"],
        permissions: ["quotes.write", "clients.read"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays", () => {
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
      capabilities: { nodeTypes: [], actions: [], permissions: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing capabilities", () => {
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string array entries", () => {
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
      capabilities: { nodeTypes: [1], actions: [], permissions: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects arrays with more than 512 entries", () => {
    const many = Array.from({ length: 513 }, (_, i) => `p${i}`);
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
      capabilities: { nodeTypes: [], actions: [], permissions: many },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2:** Run to verify failure:
```bash
pnpm --filter @kibadist/agentui-validate test session-init
```

- [ ] **Step 3:** Update `packages/validate/src/schemas.ts`. Find the `sessionMetaSchema` block. After it, add:

```ts
export const sessionInitSchema = baseEventSchema.extend({
  op: z.literal("session.init"),
  capabilities: z.object({
    nodeTypes: z.array(z.string().min(1).max(256)).max(512),
    actions: z.array(z.string().min(1).max(256)).max(512),
    permissions: z.array(z.string().min(1).max(256)).max(512),
  }),
});
```

Then find `agentWireEventSchema` (around line 187 — the big `z.union([...])`) and add `sessionInitSchema` as the last entry in the array.

- [ ] **Step 4:** Run tests:
```bash
pnpm --filter @kibadist/agentui-validate test
pnpm typecheck
```
All passing, typecheck clean.

- [ ] **Step 5:** Commit:
```bash
git add packages/validate/src/schemas.ts packages/validate/test/session-init.test.ts
git commit -m "feat(validate): sessionInitSchema (DET-153)"
```

---

## Task 3: Reducer — capabilities state

**Files:**
- Modify: `packages/react/src/reducer.ts`
- Create: `packages/react/test/reducer-capabilities.test.ts`

- [ ] **Step 1: Write failing tests** at `packages/react/test/reducer-capabilities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { agentReducer, createInitialAgentState } from "../src/reducer.js";
import type { SessionInitEvent, UIToastEvent, UIResetEvent } from "@kibadist/agentui-protocol";

const baseFields = { v: 1 as const, id: "e", ts: "t", sessionId: "s" };

function initEvent(perms: string[]): SessionInitEvent {
  return {
    ...baseFields,
    op: "session.init",
    capabilities: {
      nodeTypes: ["Card"],
      actions: ["confirm"],
      permissions: perms,
    },
  };
}

describe("agentReducer — session.init / capabilities", () => {
  it("initial state has declared=false and empty sets", () => {
    const s = createInitialAgentState();
    expect(s.capabilities.declared).toBe(false);
    expect(s.capabilities.nodeTypes.size).toBe(0);
    expect(s.capabilities.actions.size).toBe(0);
    expect(s.capabilities.permissions.size).toBe(0);
  });

  it("session.init populates capabilities and sets declared=true", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, initEvent(["quotes.write", "clients.read"]));
    expect(s.capabilities.declared).toBe(true);
    expect(s.capabilities.nodeTypes.has("Card")).toBe(true);
    expect(s.capabilities.actions.has("confirm")).toBe(true);
    expect(s.capabilities.permissions.has("quotes.write")).toBe(true);
    expect(s.capabilities.permissions.has("clients.read")).toBe(true);
  });

  it("a second session.init OVERWRITES (not merges)", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, initEvent(["quotes.write"]));
    s = agentReducer(s, initEvent(["clients.read"]));
    expect(Array.from(s.capabilities.permissions)).toEqual(["clients.read"]);
  });

  it("ui.reset preserves capabilities", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, initEvent(["quotes.write"]));
    const caps = s.capabilities;
    const reset: UIResetEvent = { ...baseFields, op: "ui.reset" };
    s = agentReducer(s, reset);
    expect(s.capabilities).toBe(caps);
  });

  it("unrelated dispatches keep capabilities referentially equal", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, initEvent(["quotes.write"]));
    const caps = s.capabilities;
    const toast: UIToastEvent = { ...baseFields, op: "ui.toast", level: "info", message: "hi" };
    s = agentReducer(s, toast);
    expect(s.capabilities).toBe(caps);
  });
});
```

- [ ] **Step 2:** Run failing tests:
```bash
pnpm --filter @kibadist/agentui-react test reducer-capabilities
```

- [ ] **Step 3:** Update `packages/react/src/reducer.ts`:

a. Add `SessionInitEvent` to the import block at the top.

b. Add a `Capabilities` interface near the top-of-state types (after `OptimisticEntry`):

```ts
export interface Capabilities {
  declared: boolean;
  nodeTypes: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
}
```

c. Extend `AgentState`:
```ts
export interface AgentState {
  // ...existing
  capabilities: Capabilities;
}
```

d. Initialize in `createInitialAgentState`:
```ts
capabilities: {
  declared: false,
  nodeTypes: new Set(),
  actions: new Set(),
  permissions: new Set(),
},
```

e. Add `SessionInitEvent` to the `AgentAction` union.

f. Add an `applySessionInit` function:
```ts
function applySessionInit(state: AgentState, e: SessionInitEvent): AgentState {
  return {
    ...state,
    capabilities: {
      declared: true,
      nodeTypes: new Set(e.capabilities.nodeTypes),
      actions: new Set(e.capabilities.actions),
      permissions: new Set(e.capabilities.permissions),
    },
  };
}
```

g. In the main reducer's switch, replace the temporary `case "session.init": return state;` (if you added one in Task 1) with `case "session.init": return applySessionInit(state, action);`.

h. CRITICAL: `applyReset` (if it exists) must NOT touch `capabilities`. Verify by reading the existing reset path — it likely returns a fresh state. If so, fix it to preserve `capabilities`:

```ts
function applyReset(state: AgentState): AgentState {
  return {
    ...createInitialAgentState(),
    capabilities: state.capabilities, // preserved
  };
}
```

If the existing pattern uses a different name (e.g. `__reset__`), apply the same fix.

- [ ] **Step 4:** Run tests:
```bash
pnpm --filter @kibadist/agentui-react test reducer-capabilities
pnpm --filter @kibadist/agentui-react test
pnpm typecheck
```

All passing. If old reducer tests break because the initial state now has a `capabilities` field, that's fine — update those assertions to match the new shape (use deep equality or add `capabilities` to expected objects).

- [ ] **Step 5:** Commit:
```bash
git add packages/react/src/reducer.ts packages/react/test/reducer-capabilities.test.ts
git commit -m "feat(react): reducer stores capabilities from session.init (DET-153)"
```

---

## Task 4: Renderer permission gating

**Files:**
- Modify: `packages/react/src/renderer.tsx`
- Create: `packages/react/test/renderer-permissions.test.tsx`

- [ ] **Step 1: Write failing tests** at `packages/react/test/renderer-permissions.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AgentRenderer } from "../src/renderer.js";
import { createRegistry } from "../src/registry.js";
import { createInitialAgentState } from "../src/reducer.js";
import type { AgentState } from "../src/reducer.js";

const Card = ({ label }: { label: string }) => <div data-testid="card">{label}</div>;

function makeState(opts: { declared: boolean; perms: string[]; nodeLabel?: string }): AgentState {
  const s = createInitialAgentState();
  s.capabilities = {
    declared: opts.declared,
    nodeTypes: new Set(["Card"]),
    actions: new Set(),
    permissions: new Set(opts.perms),
  };
  s.nodes.push({
    key: "n1",
    type: "Card",
    props: { label: opts.nodeLabel ?? "hello" },
  });
  s.byKey.set("n1", 0);
  return s;
}

describe("AgentRenderer — permission gating", () => {
  const registry = createRegistry({
    Card: { component: Card, requires: ["quotes.write"] },
  });

  it("renders the node when declared=false (back-compat)", () => {
    const state = makeState({ declared: false, perms: [] });
    const { getByTestId } = render(<AgentRenderer state={state} registry={registry} />);
    expect(getByTestId("card").textContent).toBe("hello");
  });

  it("renders the node when declared=true and permissions match", () => {
    const state = makeState({ declared: true, perms: ["quotes.write"] });
    const { getByTestId } = render(<AgentRenderer state={state} registry={registry} />);
    expect(getByTestId("card").textContent).toBe("hello");
  });

  it("hides the node silently when declared=true and permissions are missing", () => {
    const state = makeState({ declared: true, perms: [] });
    const { container } = render(<AgentRenderer state={state} registry={registry} />);
    expect(container.querySelector("[data-testid='card']")).toBeNull();
  });

  it("calls permissionFallback with the missing permissions list", () => {
    const state = makeState({ declared: true, perms: [] });
    const { getByTestId } = render(
      <AgentRenderer
        state={state}
        registry={registry}
        permissionFallback={(node, missing) => (
          <div data-testid="blocked">
            {node.key}/{missing.join(",")}
          </div>
        )}
      />,
    );
    expect(getByTestId("blocked").textContent).toBe("n1/quotes.write");
  });

  it("computes missing as the diff, not the full required list", () => {
    const multiRegistry = createRegistry({
      Card: { component: Card, requires: ["quotes.write", "clients.read"] },
    });
    const state = makeState({ declared: true, perms: ["clients.read"] });
    const { getByTestId } = render(
      <AgentRenderer
        state={state}
        registry={multiRegistry}
        permissionFallback={(_node, missing) => (
          <div data-testid="blocked">{missing.join(",")}</div>
        )}
      />,
    );
    expect(getByTestId("blocked").textContent).toBe("quotes.write");
  });

  it("ignores nodes whose spec.requires is undefined", () => {
    const noReqRegistry = createRegistry({ Card: { component: Card } });
    const state = makeState({ declared: true, perms: [] });
    const { getByTestId } = render(<AgentRenderer state={state} registry={noReqRegistry} />);
    expect(getByTestId("card").textContent).toBe("hello");
  });
});
```

- [ ] **Step 2:** Run failing:
```bash
pnpm --filter @kibadist/agentui-react test renderer-permissions
```

- [ ] **Step 3:** Update `packages/react/src/renderer.tsx`:

a. Add to `AgentRendererProps`:
```ts
permissionFallback?: (node: UINode, missing: string[]) => ReactNode;
```

b. Destructure it in the function signature.

c. In the per-node loop, just before calling `renderOne`, check the permission gate. The cleanest spot: extend `renderOne` to take `capabilities` and `permissionFallback` and do the check inline. Update its signature:

```ts
function renderOne(
  node: UINode,
  registry: Registry,
  fallback: ((node: UINode) => ReactNode) | undefined,
  capabilities: AgentState["capabilities"],
  permissionFallback: ((node: UINode, missing: string[]) => ReactNode) | undefined,
): ReactNode {
  const spec = registry.get(node.type);
  if (!spec) { /* existing unknown-type fallback */ }
  if (capabilities.declared && spec.requires && spec.requires.length > 0) {
    const missing = spec.requires.filter((p) => !capabilities.permissions.has(p));
    if (missing.length > 0) {
      return permissionFallback ? permissionFallback(node, missing) : null;
    }
  }
  if (spec.propsSchema) { /* existing validation */ }
  return createElement(spec.component, node.props);
}
```

Pass `state.capabilities` and `permissionFallback` at the call site (around line 92):

```ts
const el = renderOne(node, registry, fallback, state.capabilities, permissionFallback);
```

- [ ] **Step 4:** Run tests:
```bash
pnpm --filter @kibadist/agentui-react test
pnpm typecheck
```

Both clean.

- [ ] **Step 5:** Commit:
```bash
git add packages/react/src/renderer.tsx packages/react/test/renderer-permissions.test.tsx
git commit -m "feat(react): AgentRenderer gates on ComponentSpec.requires (DET-153)"
```

---

## Task 5: useCapabilities hook

**Files:**
- Create: `packages/react/src/use-capabilities.ts`
- Create: `packages/react/test/use-capabilities.test.tsx`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Write failing tests** at `packages/react/test/use-capabilities.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCapabilities } from "../src/use-capabilities.js";
import { AgentStateProvider } from "../src/agent-state-context.js";
import { createAgentStore } from "../src/store.js";
import type { SessionInitEvent, UIToastEvent } from "@kibadist/agentui-protocol";

const base = { v: 1 as const, id: "e", ts: "t", sessionId: "s" };

describe("useCapabilities", () => {
  it("returns empty sets and declared=false before session.init", () => {
    const store = createAgentStore();
    const { result } = renderHook(() => useCapabilities(), {
      wrapper: ({ children }) => (
        <AgentStateProvider store={store}>{children}</AgentStateProvider>
      ),
    });
    expect(result.current.declared).toBe(false);
    expect(result.current.permissions.size).toBe(0);
    expect(result.current.hasPermission("anything")).toBe(false);
    expect(result.current.canAct("anything")).toBe(false);
    expect(result.current.canEmit("anything")).toBe(false);
  });

  it("reflects session.init payload", () => {
    const store = createAgentStore();
    const { result } = renderHook(() => useCapabilities(), {
      wrapper: ({ children }) => (
        <AgentStateProvider store={store}>{children}</AgentStateProvider>
      ),
    });
    const evt: SessionInitEvent = {
      ...base,
      op: "session.init",
      capabilities: {
        nodeTypes: ["Card"],
        actions: ["confirm"],
        permissions: ["quotes.write"],
      },
    };
    act(() => {
      store.send(evt);
    });
    expect(result.current.declared).toBe(true);
    expect(result.current.hasPermission("quotes.write")).toBe(true);
    expect(result.current.hasPermission("nope")).toBe(false);
    expect(result.current.canAct("confirm")).toBe(true);
    expect(result.current.canEmit("Card")).toBe(true);
  });

  it("is referentially stable across unrelated dispatches", () => {
    const store = createAgentStore();
    const { result, rerender } = renderHook(() => useCapabilities(), {
      wrapper: ({ children }) => (
        <AgentStateProvider store={store}>{children}</AgentStateProvider>
      ),
    });
    const first = result.current;
    const toast: UIToastEvent = { ...base, op: "ui.toast", level: "info", message: "x" };
    act(() => store.send(toast));
    rerender();
    expect(result.current).toBe(first);
  });
});
```

- [ ] **Step 2:** Verify failure:
```bash
pnpm --filter @kibadist/agentui-react test use-capabilities
```

- [ ] **Step 3:** Implement `packages/react/src/use-capabilities.ts`:

```ts
"use client";

import { useMemo } from "react";
import { useAgentSelector } from "./selectors.js";
import type { Capabilities } from "./reducer.js";

export interface UseCapabilitiesResult {
  declared: boolean;
  nodeTypes: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  hasPermission(perm: string): boolean;
  canAct(action: string): boolean;
  canEmit(nodeType: string): boolean;
}

export function useCapabilities(): UseCapabilitiesResult {
  const capabilities = useAgentSelector((s): Capabilities => s.capabilities);
  return useMemo<UseCapabilitiesResult>(
    () => ({
      declared: capabilities.declared,
      nodeTypes: capabilities.nodeTypes,
      actions: capabilities.actions,
      permissions: capabilities.permissions,
      hasPermission: (p) => capabilities.permissions.has(p),
      canAct: (a) => capabilities.actions.has(a),
      canEmit: (t) => capabilities.nodeTypes.has(t),
    }),
    [capabilities],
  );
}
```

Quick check: `useAgentSelector` exists — read `packages/react/src/selectors.ts` to confirm the function signature; adjust the call site if it takes different args (e.g. some implementations take `(selector, equalityFn)`).

- [ ] **Step 4:** Export from `packages/react/src/index.ts`:
```ts
export { useCapabilities } from "./use-capabilities.js";
export type { UseCapabilitiesResult } from "./use-capabilities.js";
export type { Capabilities } from "./reducer.js";
```

- [ ] **Step 5:** Run all tests:
```bash
pnpm --filter @kibadist/agentui-react test
pnpm typecheck
```

All clean.

- [ ] **Step 6:** Commit:
```bash
git add packages/react/src/use-capabilities.ts packages/react/src/index.ts packages/react/test/use-capabilities.test.tsx
git commit -m "feat(react): useCapabilities hook (DET-153)"
```

---

## Task 6: Docs + final verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1:** Add a `## Capabilities handshake` subsection to `README.md`. Place it near the other v0.8 additions (JSON Patch, Streaming partial-JSON). Content:

```markdown
### Capabilities handshake

Servers can declare available node types, accepted actions, and the session's effective permissions as the first event of a stream:

```ts
// server-side
{
  op: "session.init",
  capabilities: {
    nodeTypes: ["Card", "Quote", "ClientCard"],
    actions: ["purchase.confirm", "quote.send"],
    permissions: ["quotes.write", "clients.read"],
  }
}
```

Consumers read the declaration via `useCapabilities()`:

```ts
import { useCapabilities } from "@kibadist/agentui-react";

function ConfirmButton() {
  const caps = useCapabilities();
  if (!caps.canAct("purchase.confirm")) return null;
  return <button>Confirm</button>;
}
```

`AgentRenderer` consults `ComponentSpec.requires` against `permissions`. If the session lacks any required permission, the node hides silently — or renders a host-supplied fallback:

```ts
<AgentRenderer
  state={state}
  registry={registry}
  permissionFallback={(node, missing) => (
    <div>You need {missing.join(", ")} to view this.</div>
  )}
/>
```

Servers that don't emit `session.init` see no behavior change — gating only activates after the handshake.
```

(Mind the nested code fences — use 4-backticks for the outer block if needed.)

- [ ] **Step 2:** Append to the v0.8.0 `### Added` list in `CHANGELOG.md`:

```markdown
- New `session.init` wire event declares node types, actions, and effective permissions. `AgentRenderer` gates on `ComponentSpec.requires`; consumers read the declaration via `useCapabilities()` (returns `hasPermission`, `canAct`, `canEmit`). Servers that don't emit `session.init` see no behavior change. ([DET-153](https://linear.app/detailing-app/issue/DET-153))
```

- [ ] **Step 3:** Full verification:

```bash
pnpm typecheck
pnpm test
pnpm build
```

All clean.

- [ ] **Step 4:** Commit:
```bash
git add README.md CHANGELOG.md
git commit -m "docs: capability handshake + permission-gated renderers (DET-153)"
```

---

## Self-Review Checklist

- [ ] `session.init` event added to protocol, validate, AgentWireEvent, and the reducer's AgentAction union
- [ ] Reducer's `applyReset` (or equivalent) preserves capabilities
- [ ] Renderer gates only when `capabilities.declared === true` — preserves back-compat
- [ ] `permissionFallback` receives the diff, not the full requires list
- [ ] `useCapabilities` result is referentially stable across unrelated dispatches (verified by test)
- [ ] README + CHANGELOG updated
