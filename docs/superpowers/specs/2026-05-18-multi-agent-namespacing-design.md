# Multi-agent namespacing (DET-143 / v0.5.5)

Linear: [DET-143 — v0.5 — Multi-agent namespacing (`<AgentRoot id>` + scoped hooks)](https://linear.app/detailing-app/issue/DET-143)

## Goal

Allow two or more `<AgentRoot>` instances to coexist in the same tree by tagging each with an `id`. All hooks gain an optional `id` parameter; id-less calls keep their current behavior (resolve to nearest root). Cheap to ship now alongside DET-142, expensive to retrofit later.

## Non-goals (deliberate)

- Cross-agent state synchronization. Each agent's state is independent.
- "Find by predicate" / discovery APIs. Out of scope.
- DevTools naming improvements beyond the trivial. (`displayName` picks up the id naturally where it helps.)
- Replacing the existing four contexts. The registry is additive; the legacy contexts continue to carry the nearest scope (preserves back-compat and zero overhead for the common case).

## Architecture

```
<AgentRoot id="chat" endpoint="/api/chat">
  ┌────────────────────────────────────────────┐
  │ AgentRootRegistry.Provider value=          │
  │   { id:"chat", session, config, store,     │
  │     actionSender, parent: null }           │
  │                                            │
  │  [legacy contexts populated with chat's]   │
  │                                            │
  │   <AgentRoot id="planner" endpoint=...>    │
  │     ┌────────────────────────────────────┐ │
  │     │ AgentRootRegistry.Provider value=  │ │
  │     │   { id:"planner", session, ...,    │ │
  │     │     parent: <chat's entry> }       │ │
  │     │                                    │ │
  │     │  [legacy contexts → planner's]     │ │
  │     │  {children}                        │ │
  │     └────────────────────────────────────┘ │
  └────────────────────────────────────────────┘

useAgentSession('chat')    → walks registry from current entry, finds id="chat"
useAgentSession('planner') → finds id="planner"
useAgentSession()          → reads legacy SessionContext (nearest = planner)
useAgentSession('unknown') → throws
```

The registry is a singly-linked list traversable via `parent` pointers. Each `<AgentRoot>` reads the parent entry from context once per render, builds its own entry, and pushes it.

## Public API change summary

All hooks gain an optional `id` parameter. The parameter slot is the LAST optional position so existing call sites need no changes:

| Hook | New signature |
|---|---|
| `useAgentSession(id?: string)` | (already had `id?` placeholder from DET-142; semantics activated) |
| `useAgentHistory(id?: string)` | (already had `id?` placeholder; semantics activated) |
| `useAgentAction(id?: string)` | NEW param |
| `useAgentNodes(id?: string)` | NEW param |
| `useAgentToasts(id?: string)` | NEW param |
| `useAgentNavigate(id?: string)` | NEW param |
| `useAgentSelector<T>(selector, eq?, id?)` | NEW third positional param |
| `useToolCalls(id?: string)` | NEW param |
| `useToolCall(callId, id?: string)` | NEW second positional param |
| `useReasoning(id?: string)` | NEW param |
| `useLatestReasoning(id?: string)` | NEW param |
| `useOptimistic(entityKey, id?: string)` | NEW second positional param |
| `useOptimisticAll(id?: string)` | NEW param |

## Registry context (`packages/react/src/agent-root-registry.tsx`)

```ts
import { createContext, useContext } from "react";
import type { ActionSender } from "./action-context.js";
import type { AgentStore } from "./store.js";
import type { AgentRootConfig, UseAgentSessionResult } from "./session-context.js";

export interface AgentRootRegistryEntry {
  /** The `id` prop from `<AgentRoot>`. `undefined` for un-id'd roots. */
  id: string | undefined;
  session: UseAgentSessionResult;
  config: AgentRootConfig;
  store: AgentStore;
  actionSender: ActionSender;
  /** Parent entry in the linked list, or null at the outermost root. */
  parent: AgentRootRegistryEntry | null;
}

export const AgentRootRegistry = createContext<AgentRootRegistryEntry | null>(null);

export function useAgentRootRegistryEntry(): AgentRootRegistryEntry | null {
  return useContext(AgentRootRegistry);
}

/**
 * Walk the linked list looking for an entry with the given id. With
 * `undefined`, returns the nearest entry (the entry parameter itself).
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

The `AgentRootRegistry` context is exported for advanced consumers (e.g., test helpers that want to peek the linked list) but the hooks themselves are the recommended interface.

## `<AgentRoot>` integration

Inside `AgentRoot`, after the existing `sessionValue` / `configValue` / `actionSender` calculations:

```tsx
const parentEntry = useContext(AgentRootRegistry);

// Mount-time duplicate-id check.
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

Wrap the existing provider chain inside `<AgentRootRegistry.Provider value={registryEntry}>`. The legacy four providers (`SessionProvider`, `AgentStateProvider`, `AgentActionProvider`) remain in place and continue to carry the nearest scope.

## Hook updates

### `useAgentSession(id?)` (session-context.tsx)

```ts
export function useAgentSession(id?: string): UseAgentSessionResult {
  const nearest = useContext(SessionContext);
  const entry = useAgentRootRegistryEntry();

  if (id !== undefined) {
    const resolved = resolveAgentRoot(entry, id);
    if (resolved === null) {
      throw new Error(
        `[agentui] No <AgentRoot id="${id}"> found in the tree.`,
      );
    }
    return resolved.session;
  }

  if (nearest === null) {
    throw new Error("[agentui] useAgentSession must be used inside <AgentRoot>.");
  }
  return nearest;
}
```

Same exact pattern for `useAgentRootConfig(id?)`, `useAgentAction(id?)`.

### `useAgentHistory(id?)` (use-agent-history.ts)

The hook currently reads `sessionId` from `useAgentSession()` and `config` from `useAgentRootConfig()`. With id support, both lookups pass the id:

```ts
export function useAgentHistory(id?: string): UseAgentHistoryResult {
  const { sessionId } = useAgentSession(id);
  const config = useAgentRootConfig(id);
  // ... rest unchanged
}
```

The internal `seqRef`, fetch logic, and state are per-hook-instance — independent of which agent's data we're fetching. No further changes.

### `useAgentSelector(selector, eq?, id?)` (selectors.ts)

Currently the selector reads `store = useAgentStore()`. The change: introduce a small `useResolvedStore(id)` helper that returns the correct store for the resolved agent:

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

`useAgentSelector` swaps its `const store = useAgentStore();` for `const store = useResolvedStore(id);`. The rest of the implementation (sentinel, refs, getSnapshot via useSyncExternalStore) is unchanged.

The convenience hooks pass `id` through:

```ts
export const useAgentNodes = (id?: string) =>
  useAgentSelector((s) => s.nodes, undefined, id);

export const useAgentToasts = (id?: string) =>
  useAgentSelector((s) => s.toasts, undefined, id);

// ... and so on for navigate, toolCalls, toolCall, reasoning, etc.
```

### `useAgentAction(id?)` (action-context.tsx)

```ts
export function useAgentAction(id?: string): ActionSender {
  const nearest = useContext(AgentActionContext);
  const entry = useAgentRootRegistryEntry();

  if (id !== undefined) {
    const resolved = resolveAgentRoot(entry, id);
    if (resolved === null) {
      throw new Error(
        `[agentui] No <AgentRoot id="${id}"> found in the tree.`,
      );
    }
    return resolved.actionSender;
  }

  return nearest; // existing default (already a noop-warning sender when no provider)
}
```

The existing `useAgentAction` returns a no-op when no provider is mounted (it has a `noop` default value). With id support, providing an unknown id throws explicitly — that's the new behavior, since the host clearly asked for a specific agent.

## Error semantics

| Condition | Behavior |
|---|---|
| `useAgentSession('chat')` outside any AgentRoot | Throw: "No `<AgentRoot id="chat">` found in the tree." |
| `useAgentSession('chat')` inside an AgentRoot without that id | Same throw |
| `useAgentSession()` inside an AgentRoot (any id or no id) | Resolves to nearest entry's session |
| `useAgentSession()` outside any AgentRoot | Existing throw: must be inside `<AgentRoot>` |
| Two nested AgentRoots with the same id | Throw from the inner root's effect: "Duplicate <AgentRoot id=\"..\">…" |
| Same id in separate sibling subtrees (not nested) | OK — they're in different registry chains |

## Tests

**`packages/react/test/multi-agent.test.tsx`** (new — 5 tests):

1. **Two nested roots; scoped hooks resolve to the right one.** Mount `<AgentRoot id="chat"><AgentRoot id="planner"><Probe /></AgentRoot></AgentRoot>`. Probe calls `useAgentSession('chat')` and `useAgentSession('planner')`. Verify the chat probe sees the chat sessionId and the planner probe sees the planner sessionId, using distinct `fetch` mocks per root.

2. **Hook without id resolves to nearest root.** Same nesting. Probe calls `useAgentSession()` (no id) from inside the inner root. Asserts it returns the planner's sessionId.

3. **Hook with unknown id throws.** One AgentRoot with `id="chat"`. Probe calls `useAgentSession('planner')`. Render throws with "No `<AgentRoot id="planner">` found in the tree."

4. **Duplicate id at nested AgentRoots throws at mount.** Mount `<AgentRoot id="chat"><AgentRoot id="chat">...</AgentRoot></AgentRoot>`. Assert the render throws with "Duplicate <AgentRoot id=\"chat\">..."

5. **`useAgentNodes(id)` resolves to the right store.** Nest chat + planner. Inject `ui.append` events into each via their respective MockEventSources. A probe calling `useAgentNodes('chat')` from inside the inner root sees only chat's nodes; `useAgentNodes('planner')` sees only planner's.

## File touches

| File | Action |
|---|---|
| `packages/react/src/agent-root-registry.tsx` | Create — registry context, entry interface, resolver helper |
| `packages/react/src/agent-root.tsx` | Modify — read parent entry, mount-time duplicate-id check, provide registry entry |
| `packages/react/src/session-context.tsx` | Modify — activate `id` on `useAgentSession` and `useAgentRootConfig` |
| `packages/react/src/use-agent-history.ts` | Modify — pass `id` through to inner hooks |
| `packages/react/src/selectors.ts` | Modify — `useAgentSelector(selector, eq?, id?)` via `useResolvedStore`; convenience hooks forward `id` |
| `packages/react/src/action-context.tsx` | Modify — `useAgentAction(id?)` |
| `packages/react/src/index.ts` | Modify — export `AgentRootRegistry` + `useAgentRootRegistryEntry` + `resolveAgentRoot` for advanced use |
| `packages/react/test/multi-agent.test.tsx` | Create — 5 tests |
| `CHANGELOG.md` | Extend 0.5.0 |
| `README.md` | One paragraph under "Quick start with `<AgentRoot>`" |

## Edge cases

- **`id` changes between renders on an `<AgentRoot>`.** Allowed. The registry entry's `useMemo` re-keys; the duplicate-id check effect re-runs with the new id. Hooks captured by descendants continue resolving correctly (React re-renders them with the fresh registry).
- **No AgentRoot, only `<AgentStateProvider store={...}>` (current test pattern).** Id-aware hooks called with `id` throw "No <AgentRoot id=\"..\">…"; id-less hooks behave as today. Existing tests for selectors / reducer don't pass `id`, so they're unaffected.
- **Same id at different depths but in separate sibling subtrees.** Each subtree has its own registry chain. No conflict.
- **Very deep nesting.** Linked-list walk is O(depth). Real-world depth is 1-2; no practical concern.
- **`useAgentAction()` (no id) outside any provider.** Existing default behavior (no-op warner) preserved. Id-aware path requires AgentRoot.

## Migration

Strictly additive. Existing apps (single agent, no id) continue working unchanged. Adding `id="..."` to an existing `<AgentRoot>` is opt-in. Adding `id` parameters to hook calls is opt-in.

The `<AgentRuntimeProvider>` legacy render-prop wrapper (v0.4-ish) is NOT updated for multi-agent — it never had an id. Hosts that want multi-agent migrate to `<AgentRoot>`.

## Open questions

None blocking. One resolved inline:

- **Should the legacy contexts be removed in favor of registry-only?** No. Existing standalone `<AgentStateProvider>` usage (selector tests, isolated experiments) would break. The registry is additive; legacy contexts continue to back the id-less path with zero overhead.

## Versioning

Ships as part of the in-progress 0.5.0 release. With this ticket the v0.5 cycle is complete (DET-139 through DET-143).
