# Optimistic state slice (DET-141 / v0.5.3)

Linear: [DET-141 — v0.5 — Optimistic state slice (apply / confirm / rollback)](https://linear.app/detailing-app/issue/DET-141)

## Goal

Ship first-class optimistic UI primitives so hosts stop hand-rolling parallel stores. Three wire events (`optimistic.apply`, `optimistic.confirm`, `optimistic.rollback`) — both server-emittable AND client-dispatchable — back a new `optimistic: Map<string, OptimisticEntry>` slice on `AgentState`. Two selector hooks (`useOptimistic`, `useOptimisticAll`) and a widened `dispatch` make end-to-end usage ergonomic.

## Non-goals (deliberate)

- **Library-side TTL scheduling.** Hosts implement expiry via their own `useEffect` (`setTimeout`) using `entry.expiresAt`. Reducer-internal timers invite memory leaks and would tangle with React lifecycle.
- **Stacked / undo-able optimistic updates** for the same `entityKey`. Last-write-wins is the ticket's stance.
- **Server-driven `entityKey` resolution.** Hosts wire that themselves.
- **Auto-rendering of patches via the renderer.** Hosts merge `useOptimistic(key)` with their canonical entity data in component code.

## Architecture

```
SSE wire stream                  React component
       │                               │
       │ optimistic.* events           │ dispatch({ op: 'optimistic.apply', ... })
       │                               │
       ▼                               ▼
     useAgentStream → store.send → agentReducer
                                       │
                                       ▼
                          AgentState.optimistic Map<entityKey, entry>
                                       │
                                       ▼ selector hooks
                                  useOptimistic(entityKey)
                                  useOptimisticAll()
```

Optimistic events arrive from BOTH directions:
1. **Server-emitted** (over SSE) — when the backend wants to acknowledge or roll back a host-initiated optimistic update.
2. **Client-dispatched** (via the widened `dispatch`) — when the host wants to immediately overlay a patch on its UI before the server response lands.

The `dispatch` widening from `UIEvent → AgentWireEvent` is the only `useAgentStream` API change.

## Three distinct identifiers

The optimistic protocol uses three IDs that serve different roles. Worth calling out because they look superficially similar:

| Field | Scope | Purpose |
|---|---|---|
| `BaseEvent.id` | Per-event | Wire event id. Unique per event. Used for telemetry/dedup. |
| `entityKey` | Per-entity | Host-defined entity identifier (`"quote:q-123"`). Same across the apply → confirm/rollback lifecycle for the same entity. |
| `originId` | Per-application | Unique id for THIS optimistic application. Different for each `apply` even of the same `entityKey`. |

The three-id design is what makes the "apply A → apply B (same entityKey) → confirm A" race resolve cleanly: `confirm` looks up by `originId=A`, doesn't find it (B's apply overwrote A's entry under the entityKey), no-op. Without `originId` we couldn't distinguish stale confirmations from current ones.

## Protocol additions (`packages/protocol/src/index.ts`)

```ts
export interface OptimisticApplyEvent extends BaseEvent {
  op: "optimistic.apply";
  /** Host-defined entity identifier, e.g. "quote:q-123". */
  entityKey: string;
  /** Partial entity state to overlay. */
  patch: Record<string, unknown>;
  /** Unique id for THIS optimistic application — used by confirm/rollback. */
  originId: string;
  /** Optional TTL hint; hosts implement rollback timing themselves. */
  ttlMs?: number;
}

export interface OptimisticConfirmEvent extends BaseEvent {
  op: "optimistic.confirm";
  /** originId of the application to confirm. */
  originId: string;
}

export interface OptimisticRollbackEvent extends BaseEvent {
  op: "optimistic.rollback";
  /** originId of the application to roll back. */
  originId: string;
}

export type OptimisticEvent =
  | OptimisticApplyEvent
  | OptimisticConfirmEvent
  | OptimisticRollbackEvent;

export type OptimisticEventOp = OptimisticEvent["op"];
```

`AgentWireEvent` widens to `UIEvent | ToolEvent | ReasoningEvent | OptimisticEvent`.

## Validate schemas (`packages/validate/src/schemas.ts`)

```ts
const optimisticApplySchema = baseEventSchema.extend({
  op: z.literal("optimistic.apply"),
  entityKey: z.string().min(1).max(256),
  patch: z.record(z.string(), z.any()),
  originId: z.string().min(1).max(256),
  ttlMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
});

const optimisticConfirmSchema = baseEventSchema.extend({
  op: z.literal("optimistic.confirm"),
  originId: z.string().min(1).max(256),
});

const optimisticRollbackSchema = baseEventSchema.extend({
  op: z.literal("optimistic.rollback"),
  originId: z.string().min(1).max(256),
});

export const optimisticEventSchema = z.discriminatedUnion("op", [
  optimisticApplySchema,
  optimisticConfirmSchema,
  optimisticRollbackSchema,
]);
```

`agentWireEventSchema` widens to 16 variants. `ttlMs` upper-bounded at 24 hours and required positive — rejects degenerate values like `0` or `-100`.

## React state extension (`packages/react/src/reducer.ts`)

### New type

```ts
export interface OptimisticEntry {
  entityKey: string;
  patch: Record<string, unknown>;
  /** Unique id of this application (different per apply, even for same entityKey). */
  originId: string;
  appliedAt: string;
  /** Computed from `ttlMs` at apply time; host implements actual TTL via useEffect. */
  expiresAt?: string;
}
```

### Widened types

```ts
export interface AgentState {
  // ... existing slices preserved
  optimistic: Map<string, OptimisticEntry>;
}

export type AgentAction =
  | UIEvent
  | ToolEvent
  | ReasoningEvent
  | OptimisticEvent
  | AgentResetAction;
```

`createInitialAgentState()` initializes `optimistic: new Map()`. `ui.reset` / `__reset__` clear it via `createInitialAgentState()`.

**No `optimisticOrder` array.** Unlike tool calls and reasoning, optimistic entries are looked up by `entityKey`, not iterated in stream order. The `Map`'s native insertion order suffices for `useOptimisticAll()` consumers.

### Reducer cases

```ts
function applyOptimisticApply(state, e: OptimisticApplyEvent): AgentState {
  // Last-write-wins: overwrites any prior entry for the same entityKey.
  const expiresAt = e.ttlMs !== undefined
    ? new Date(Date.parse(e.ts) + e.ttlMs).toISOString()
    : undefined;
  const entry: OptimisticEntry = {
    entityKey: e.entityKey,
    patch: e.patch,
    originId: e.originId,
    appliedAt: e.ts,
    expiresAt,
  };
  const optimistic = new Map(state.optimistic);
  optimistic.set(e.entityKey, entry);
  return { ...state, optimistic };
}

function applyOptimisticConfirm(state, e: OptimisticConfirmEvent): AgentState {
  // Look up by originId — not entityKey. Iterate the Map; remove on match.
  for (const [key, entry] of state.optimistic) {
    if (entry.originId === e.originId) {
      const optimistic = new Map(state.optimistic);
      optimistic.delete(key);
      return { ...state, optimistic };
    }
  }
  return state; // no match — silent no-op (stale confirmation)
}

function applyOptimisticRollback(state, e: OptimisticRollbackEvent): AgentState {
  // Identical reducer code to confirm. The semantic difference (acknowledged
  // vs. rejected) lives at the wire/host layer — hosts can listen via onEvent
  // and trigger animations/telemetry differently.
  for (const [key, entry] of state.optimistic) {
    if (entry.originId === e.originId) {
      const optimistic = new Map(state.optimistic);
      optimistic.delete(key);
      return { ...state, optimistic };
    }
  }
  return state;
}
```

### Behavior matrix

| Event | Match condition | Effect |
|---|---|---|
| `optimistic.apply` | always | overwrite entry under `entityKey` (last-write-wins) |
| `optimistic.confirm` | `originId` found | remove that entry |
| `optimistic.confirm` | `originId` not found | silent no-op (state unchanged) |
| `optimistic.rollback` | `originId` found | remove that entry |
| `optimistic.rollback` | `originId` not found | silent no-op |
| `ui.reset` / `__reset__` | always | clear the whole `optimistic` map (along with all other state) |

### Why confirm and rollback have identical reducer code

From the state's perspective, both events mean "this optimistic entry is no longer authoritative; drop it." The semantic distinction (server acknowledged vs. server rejected) lives at the host layer — hosts can listen via `onEvent` to:
- Trigger success animations on `confirm`.
- Trigger error toasts and revert affordances on `rollback`.
- Differentiate telemetry on the two paths.

Keeping them as separate ops preserves that semantic clarity even though the reducer arms are identical. The 6 extra lines of code are worth the wire-protocol expressiveness.

## Selectors (`packages/react/src/selectors.ts`)

```ts
/** Subscribe to the optimistic patch for a single entity. Returns undefined when no entry. */
export function useOptimistic(entityKey: string): Record<string, unknown> | undefined {
  return useAgentSelector((s) => s.optimistic.get(entityKey)?.patch);
}

/** Subscribe to the entire optimistic Map. Re-renders on any optimistic change. */
export function useOptimisticAll(): Map<string, OptimisticEntry> {
  return useAgentSelector((s) => s.optimistic);
}
```

Default `Object.is` works for both:
- `useOptimistic(entityKey)` — `Map.get(entityKey)?.patch` returns the same `Record<string, unknown>` reference across unrelated state changes. When an unrelated entity's entry changes, the requested entity's patch is unaffected.
- `useOptimisticAll()` — the `Map` reference itself changes on every apply/confirm/rollback (reducer creates `new Map(...)` each time). That's the desired behavior: any optimistic change re-renders global consumers.

## Dispatch widening (`packages/react/src/use-agent-stream.ts`)

Currently:
```ts
dispatch: (event: UIEvent) => void;
```

Widens to:
```ts
dispatch: (event: AgentWireEvent) => void;
```

`AgentWireEvent` is a superset of `UIEvent`, so existing callers continue to type-check. The internal `store.send(event)` already accepts the wider `AgentAction` type — no implementation change beyond the public signature.

## TTL — host pattern

The library captures `expiresAt` on the entry but does not start any timer. Host pattern documented in JSDoc and README:

```tsx
function OptimisticExpiry({ sessionId }: { sessionId: string }) {
  const all = useOptimisticAll();
  const { dispatch } = useAgentStream({ url: "...", sessionId });

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [, entry] of all) {
      if (!entry.expiresAt) continue;
      const msUntilExpiry = Date.parse(entry.expiresAt) - Date.now();
      const fire = () => {
        dispatch({
          v: 1,
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          sessionId,
          op: "optimistic.rollback",
          originId: entry.originId,
        });
      };
      if (msUntilExpiry <= 0) fire();
      else timers.push(setTimeout(fire, msUntilExpiry));
    }
    return () => { for (const t of timers) clearTimeout(t); };
  }, [all, dispatch, sessionId]);

  return null;
}
```

Library-internal `setTimeout` would invite memory leaks (cleanup tied to React lifecycle, not store lifecycle) and conflict with host-side scheduling layers (some hosts run their own job scheduler). Host-controlled cleanup is simpler and safer.

## Tests

### `packages/validate/test/optimistic-events.test.ts` (5 tests)

1. Round-trip `optimistic.apply` with all fields including `ttlMs`.
2. Round-trip `optimistic.apply` without `ttlMs`.
3. Round-trip `optimistic.confirm`.
4. Round-trip `optimistic.rollback`.
5. Reject `optimistic.apply` missing `entityKey`.

### `packages/react/test/reducer-optimistic.test.ts` (5 tests)

1. **Apply → confirm clears the entry.** After confirm, `optimistic.size === 0`.
2. **Apply → rollback clears the entry.**
3. **Apply A → apply B (same `entityKey`) → confirm A's `originId` is a no-op.** Entry remains with `originId === B`; reducer returns same state reference for the confirm step.
4. **`__reset__` clears all optimistic entries.**
5. **`expiresAt` is computed from `ttlMs`.** With `ttlMs: 5000` and `ts: 2026-01-01T00:00:00Z`, expect `expiresAt: 2026-01-01T00:00:05.000Z`.

### `packages/react/test/optimistic-selectors.test.tsx` (3 tests)

1. **`useOptimistic('quote:q-1')` returns the patch.** Apply event → assertion that probe sees `{ status: "confirmed" }`.
2. **`useOptimistic('quote:q-1')` does not re-render when an unrelated entityKey changes.** Render-counter probe; apply for `q-1` (one render); apply for `q-2` (no further render for the `q-1` probe).
3. **`useOptimisticAll()` reflects insertion order.** Apply two entries with different keys; assert `[...map.keys()]` equals the insert order.

## File touches

| File | Action |
|---|---|
| `packages/protocol/src/index.ts` | Add 3 event interfaces + `OptimisticEvent` + `OptimisticEventOp`; widen `AgentWireEvent` |
| `packages/validate/src/schemas.ts` | Add 3 schemas + `optimisticEventSchema`; widen `agentWireEventSchema` |
| `packages/validate/src/index.ts` | Export `optimisticEventSchema` |
| `packages/react/src/reducer.ts` | Add `OptimisticEntry`; widen `AgentState` + `AgentAction`; 3 reducer cases |
| `packages/react/src/selectors.ts` | Add `useOptimistic`, `useOptimisticAll` |
| `packages/react/src/use-agent-stream.ts` | Widen `UseAgentStreamResult.dispatch` to `AgentWireEvent` |
| `packages/react/src/index.ts` | Re-export `OptimisticEntry`, `useOptimistic`, `useOptimisticAll`, plus protocol types `OptimisticEvent`, `OptimisticApplyEvent`, `OptimisticConfirmEvent`, `OptimisticRollbackEvent` |
| `packages/validate/test/optimistic-events.test.ts` | Create — 5 schema tests |
| `packages/react/test/reducer-optimistic.test.ts` | Create — 5 reducer tests |
| `packages/react/test/optimistic-selectors.test.tsx` | Create — 3 selector tests |
| `CHANGELOG.md` | Extend existing 0.5.0 |
| `README.md` | Add "Optimistic updates" subsection |

## Edge cases

- **Apply with the same `entityKey` AND `originId` twice.** Second apply overwrites with identical content but produces a new state reference (allocates `new Map(...)`). Slight inefficiency; acceptable — hosts shouldn't generate duplicate originIds.
- **Confirm/rollback for an unknown `originId`.** Silent no-op. Documented.
- **`expiresAt` computation when `e.ts` is malformed.** `Date.parse(...)` returns `NaN`, propagated to `new Date(NaN).toISOString()` which throws. The schema requires `ts: z.string().min(1)` but doesn't enforce ISO-8601 format. Acceptable: a server emitting malformed `ts` would surface a runtime error to host; hosts will catch this in their integration tests. Hardening to `z.string().datetime()` is a separate ticket (would affect ALL events, not just optimistic).
- **`ttlMs: 0` or negative.** Schema rejects (`z.number().int().positive()`).
- **`patch: {}` (empty patch).** Allowed; semantically a no-op overlay but valid for hosts that want to mark an entity as "currently mutating" without specifying fields.
- **`dispatch` called for an optimistic event with no provider.** Same behavior as today's `dispatch` — routes through the hook's internal store, which exists regardless of `<AgentStateProvider>`. Selector hooks under that provider see the update.

## Migration

Additive across all packages:
- Servers that don't emit optimistic events are unaffected.
- `AgentState` gains one new field (`optimistic`) with empty default; existing consumers ignore it.
- `dispatch` widens; existing callers passing `UIEvent` continue to type-check.

detailing-app (DET-133 in their tracker) deletes:
- `optimistic-patch` and `optimistic-rollback` UI node types
- `optimisticStatusStore` parallel store
- `routeOptimisticStatusEvent`

…replaces them with the new event types + selector hooks.

Ships as part of the in-progress 0.5.0 release.

## Open questions

None blocking. Two resolved inline:

- **Should the reducer schedule TTL timers?** No. Host pattern documented; library stays free of stateful timers.
- **Should `useOptimistic` accept a default value?** Out of scope; hosts can `useOptimistic('key') ?? defaultPatch` inline.
