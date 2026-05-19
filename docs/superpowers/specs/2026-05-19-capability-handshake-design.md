---
ticket: DET-153
title: Capability handshake + permission-gated renderers
version_target: 0.8.0
date: 2026-05-19
---

# Capability Handshake — Design Spec

## 1. Goal

Two related but distinct concerns:

1. **Capability handshake.** The server declares — once, as the first event of a stream — which node types it can emit, which actions it accepts, and the session's effective permissions. The client surfaces all three via `useCapabilities()` so consumers can light up/down affordances at the host layer.
2. **Permission-gated rendering.** `ComponentSpec.requires: string[]` already exists in the registry but is never consulted. Wire it: at render time, if a node's spec requires permissions the session lacks, the renderer calls a new `permissionFallback?: (node, missing) => ReactNode` or hides silently.

Both are additive. Servers that never emit `session.init` get an empty capabilities envelope and renderers fall back to today's behavior (render everything).

## 2. Wire protocol

New event:

```ts
export interface SessionInitEvent extends BaseEvent {
  op: "session.init";
  capabilities: {
    nodeTypes: string[];    // server declares which node types it can emit
    actions: string[];      // and which actions it accepts
    permissions: string[];  // session's effective permissions
  };
}
```

Distinct from the existing `session.meta` (which carries `conversationId`). Both can fire per session; `session.init` first.

`AgentWireEvent` widens:
```ts
type AgentWireEvent = ... | SessionInitEvent;
```

Validate schema mirrors the interface: strings min(1).max(256), arrays max(512) entries.

## 3. Reducer state

Extend `AgentState`:

```ts
interface AgentState {
  // ...existing fields
  capabilities: Capabilities;
}

interface Capabilities {
  /** True once a session.init event has been ingested. */
  declared: boolean;
  nodeTypes: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
}
```

Initial state:
```ts
{
  declared: false,
  nodeTypes: new Set(),
  actions: new Set(),
  permissions: new Set(),
}
```

Reducer adds a `session.init` case that replaces (not merges) `capabilities` with the new declaration plus `declared: true`. Subsequent `session.init` events overwrite (e.g., after a reconnect with different permissions).

`ui.reset` does NOT clear capabilities — they're per-session, not per-conversation.

## 4. Renderer integration

`AgentRendererProps` gains:

```ts
interface AgentRendererProps {
  // ...existing fields
  permissionFallback?: (node: UINode, missing: string[]) => ReactNode;
}
```

In `renderOne`, after the spec lookup and BEFORE props validation, gate on `spec.requires`:

```ts
if (state.capabilities.declared && spec.requires && spec.requires.length > 0) {
  const missing = spec.requires.filter((p) => !state.capabilities.permissions.has(p));
  if (missing.length > 0) {
    return permissionFallback ? permissionFallback(node, missing) : null;
  }
}
```

Note: gating only applies when `state.capabilities.declared === true`. Without a handshake, registry's existing behavior wins (render everything). This preserves back-compat for servers/sessions that don't emit `session.init`.

Pass `state.capabilities` and `permissionFallback` through to `renderOne` via the existing prop drilling.

## 5. `useCapabilities` hook

New file `packages/react/src/use-capabilities.ts`:

```ts
export interface UseCapabilitiesResult {
  declared: boolean;
  nodeTypes: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  hasPermission(perm: string): boolean;
  canAct(action: string): boolean;
  canEmit(nodeType: string): boolean;
}

export function useCapabilities(): UseCapabilitiesResult;
```

Reads from the agent state context (the same store `useAgentSelector` reads from). Selector returns `state.capabilities`; result memoized so the `hasPermission`/`canAct`/`canEmit` closures are stable across renders.

Selector stability: `agentReducer` returns the SAME `capabilities` reference if the action is not `session.init`. So `useCapabilities` re-renders only when capabilities actually change. Tested via "selectors are stable when unrelated state mutates."

If no `<AgentStateProvider>` is present in the tree, throw the same error the existing selectors do (or return an empty result with `declared: false` — match the existing convention, which is to throw).

## 6. File layout

```
packages/protocol/src/index.ts            # MODIFY — add SessionInitEvent; widen AgentWireEvent
packages/validate/src/schemas.ts          # MODIFY — sessionInitSchema + add to agentWireEventSchema union
packages/react/src/reducer.ts             # MODIFY — Capabilities, AgentState, session.init case
packages/react/src/renderer.tsx           # MODIFY — permissionFallback, gate via state.capabilities
packages/react/src/use-capabilities.ts    # NEW — hook
packages/react/src/index.ts               # MODIFY — exports

packages/validate/test/session-init.test.ts          # NEW
packages/react/test/reducer-capabilities.test.ts     # NEW
packages/react/test/renderer-permissions.test.tsx    # NEW
packages/react/test/use-capabilities.test.tsx        # NEW
```

## 7. Testing

### 7.1 Validate
- `session.init` with valid shape parses; missing required field rejects; arrays beyond max reject.

### 7.2 Reducer
- After `session.init` with `permissions: ["quotes.write", "clients.read"]`, `state.capabilities.permissions` is a Set of those two values and `declared` is `true`.
- A second `session.init` overwrites (not merges).
- `ui.reset` preserves capabilities (assert pre/post `===`).
- Non-`session.init` actions return the same `capabilities` reference (referential equality).

### 7.3 Renderer
- Registry with `{ Card: { component, requires: ["quotes.write"] } }`:
  - With `declared: false`, Card renders (handshake never happened — back-compat).
  - With `declared: true, permissions: ["quotes.write"]`, Card renders.
  - With `declared: true, permissions: []`, Card hides (no fallback) — output is empty.
  - With `declared: true, permissions: []` AND `permissionFallback={(node, missing) => <div>blocked: {missing.join()}</div>}`, fallback renders with `missing === ["quotes.write"]`.
- Multiple required perms: missing list is the diff, not all of them.

### 7.4 useCapabilities
- After `session.init`, hook returns populated sets and `declared: true`.
- `hasPermission("x")` correctly checks membership.
- Returned object is stable across an unrelated dispatch (`ui.toast`).
- `canEmit("Card")` checks against declared `nodeTypes`.

## 8. Out of scope

- Lazy-loading renderers via declared `nodeTypes` (mentioned in ticket as optional; explicit defer).
- Server-side enforcement (this is purely a client-side affordance; servers must still validate).
- Action gating at the dispatch layer (`AgentActionProvider`). For v0.8, hosts use `canAct()` from the hook to gate UI; protocol-level enforcement deferred.
- Granular per-route permissions / dynamic permission grants mid-session.

## 9. Acceptance criteria

- `pnpm test` passes including 4 new test files.
- `pnpm typecheck` clean.
- A demo app that mounts `<AgentRenderer permissionFallback={...} />` with a `Card` requiring `quotes.write` correctly hides/renders based on `session.init` payload.
- `useCapabilities()` returns stable references when unrelated state changes.
- Servers that don't emit `session.init` see no behavior change.
- README has a "Capabilities handshake" subsection; CHANGELOG v0.8.0 records the change.
