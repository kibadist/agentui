---
ticket: DET-151
title: JSON Patch payloads for ui.replace
version_target: 0.8.0
date: 2026-05-19
---

# JSON Patch Payloads for `ui.replace` — Design Spec

## 1. Goal

Allow `ui.replace` events to carry a minimal RFC 6902 JSON Patch instead of a full `props` object. This lets agents emit small deltas for deeply nested or large nodes — smaller wire bytes, faster parse, easier composition across concurrent streams.

The full-`props` form remains valid forever. Both forms can interleave for the same key.

## 2. Wire Protocol

`UIReplaceEvent` becomes a discriminated union over the shape of the payload (not over `op`, which stays `ui.replace`). Schema-level distinction:

```ts
// Variant A (existing, unchanged):
interface UIReplacePropsEvent extends BaseEvent {
  op: "ui.replace";
  key: string;
  props: Record<string, unknown>;
  replace?: boolean;            // false (default) = shallow merge; true = full replace
}

// Variant B (new):
interface UIReplacePatchEvent extends BaseEvent {
  op: "ui.replace";
  key: string;
  patch: JsonPatch;             // RFC 6902 ops
}

type UIReplaceEvent = UIReplacePropsEvent | UIReplacePatchEvent;
```

`patch` and `props` are mutually exclusive — events containing both fail validation. Events containing neither fail validation.

### 2.1 JsonPatch shape

RFC 6902 subset, encoded as an array:

```ts
type JsonPointer = string;       // RFC 6901 — "/", "/items/0", "/a/b/-"
type JsonPatchOp =
  | { op: "add";     path: JsonPointer; value: unknown }
  | { op: "remove";  path: JsonPointer }
  | { op: "replace"; path: JsonPointer; value: unknown }
  | { op: "move";    from: JsonPointer; path: JsonPointer }
  | { op: "copy";    from: JsonPointer; path: JsonPointer }
  | { op: "test";    path: JsonPointer; value: unknown };
type JsonPatch = JsonPatchOp[];
```

`test` does not mutate; on failure the entire patch is rejected (drop, surface via `onInvalidEvent`).

Max patch length: 256 ops per event (cap to prevent abuse — typical patches are 1–10).
Max path depth: 32 segments. Max array index: 100_000 (no `Number.MAX_SAFE_INTEGER` games).

### 2.2 Application target

Paths are evaluated against the existing node's `props` object — **not** the node itself. Path `/` refers to the root of `props`. This keeps `type`, `key`, `slot`, and `children` immutable from JSON Patch (use full `props` form to replace `props` wholesale; use distinct events for structural changes).

## 3. Implementation

### 3.1 Validate package — schema

In `packages/validate/src/schemas.ts`, split `uiReplaceSchema` into two and union them:

```ts
const uiReplacePropsSchema = baseEventSchema.extend({
  op: z.literal("ui.replace"),
  key: z.string().min(1).max(256),
  props: z.record(z.string(), z.any()),
  replace: z.boolean().optional(),
});

const jsonPointerSchema = z.string().regex(/^(\/[^/]*)*$|^$/, "invalid JSON Pointer");
// (^$ allows the root pointer per RFC 6901; segments may be empty for "")

const jsonPatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"),     path: jsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal("remove"),  path: jsonPointerSchema }),
  z.object({ op: z.literal("replace"), path: jsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal("move"),    from: jsonPointerSchema, path: jsonPointerSchema }),
  z.object({ op: z.literal("copy"),    from: jsonPointerSchema, path: jsonPointerSchema }),
  z.object({ op: z.literal("test"),    path: jsonPointerSchema, value: z.unknown() }),
]);

const uiReplacePatchSchema = baseEventSchema.extend({
  op: z.literal("ui.replace"),
  key: z.string().min(1).max(256),
  patch: z.array(jsonPatchOpSchema).min(1).max(256),
});

const uiReplaceSchema = z.union([uiReplacePropsSchema, uiReplacePatchSchema]);
```

Because the existing `uiEventSchema` and `agentWireEventSchema` are `discriminatedUnion("op", ...)`, replacing the leaf with a `z.union` breaks discrimination. To keep discrimination by `op`, model the variant choice with `superRefine` or a custom discriminator. Concretely: keep one `uiReplaceSchema` that's an object on `op: "ui.replace"`, with `props` and `patch` both optional, plus a refinement that exactly one must be present.

```ts
const uiReplaceSchema = baseEventSchema.extend({
  op: z.literal("ui.replace"),
  key: z.string().min(1).max(256),
  props: z.record(z.string(), z.any()).optional(),
  replace: z.boolean().optional(),
  patch: z.array(jsonPatchOpSchema).min(1).max(256).optional(),
}).superRefine((val, ctx) => {
  const hasProps = val.props !== undefined;
  const hasPatch = val.patch !== undefined;
  if (hasProps === hasPatch) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ui.replace requires exactly one of `props` or `patch`",
    });
  }
  if (hasPatch && val.replace !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "`replace` cannot be combined with `patch`",
    });
  }
});
```

This preserves the outer `discriminatedUnion("op", ...)` so existing parse paths stay fast.

### 3.2 Protocol package — types

`packages/protocol/src/index.ts` — change `UIReplaceEvent` to the discriminated union of `UIReplacePropsEvent | UIReplacePatchEvent`. Keep `UIReplaceEvent` exported as the union; export the two variants by name as well. Add `JsonPatchOp` and `JsonPatch` exports.

### 3.3 React package — JSON Patch applier

New file `packages/react/src/json-patch.ts` — pure module, no React deps. Public API:

```ts
export type ApplyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export function applyPatch(target: unknown, patch: JsonPatchOp[]): ApplyResult;
```

Behavior:
- Immutable. `target` is never mutated. Each op produces a new node only along the path; siblings reused by reference.
- All-or-nothing: any failure (bad pointer, `test` mismatch, `add` to non-existent parent for non-array, `remove` of non-existent key, index out of range) aborts and returns `{ ok: false, error }`. No partial mutations applied.
- Supports `-` end-array sentinel for `add`.
- Pointer escaping: `~1` → `/`, `~0` → `~` (per RFC 6901).

Internals roughly:
- `parsePointer(p: string): string[]` — splits, unescapes, validates depth ≤ 32.
- `getAt(value, path)`, `setAt(value, path, newValue)`, `removeAt(value, path)` — copy-on-write helpers.
- `applyOp(value, op)` — dispatch on `op.op`.
- `applyPatch(value, patch)` — fold; on failure, return original failure without mutating.

Size target: ≤ 200 LOC including types. No `fast-json-patch` dep.

### 3.4 React package — reducer integration

In `packages/react/src/reducer.ts`, rewrite `applyReplace`:

```ts
function applyReplace(state: AgentState, e: UIReplaceEvent): AgentState {
  const idx = state.byKey.get(e.key);
  if (idx === undefined) return state; // no-op if key not found
  const nodes = [...state.nodes];
  const existing = nodes[idx];
  let newProps: Record<string, unknown>;
  if ("patch" in e && e.patch) {
    const result = applyPatch(existing.props, e.patch);
    if (!result.ok) return state; // drop on failure — onInvalidEvent reported by the stream layer
    newProps = result.value as Record<string, unknown>;
  } else {
    const propsEvent = e as UIReplacePropsEvent;
    newProps = propsEvent.replace
      ? { ...propsEvent.props }
      : { ...existing.props, ...propsEvent.props };
  }
  nodes[idx] = { ...existing, props: newProps };
  return { ...state, nodes, byKey: rebuildIndex(nodes) };
}
```

**Patch application failure path:** Schema validation only catches structural issues. Semantic failures (e.g., `replace` of a non-existent path, `test` mismatch) surface at apply time. The reducer treats these as no-ops on the state side, but we also need to notify the consumer. Solution: the reducer doesn't have access to `onInvalidEvent` — it's pure. Instead, surface failures by adding an optional callback on the store (`onPatchFailure?: (event: UIReplaceEvent, error: string) => void`) wired via `createAgentStore` and called from a thin layer just outside the reducer dispatch. The `useAgentStream` hook bridges `onPatchFailure` → `onInvalidEvent(rawEvent, new Error(error))`.

Simpler alternative considered and rejected: make the reducer return a result tuple. Too invasive; spreads up through every dispatcher.

Implementation choice for this spec: add `onPatchFailure` to `createAgentStore` options. The store wraps `send(event)` — when the event is `ui.replace` with `patch`, the store pre-applies and either dispatches `ui.replace` with synthesized `props` (the patched object) OR drops + calls `onPatchFailure`. Reducer stays pure and unaware of patches.

Concretely:

```ts
// store.ts send():
send(event: AgentWireEvent) {
  if (event.op === "ui.replace" && "patch" in event && event.patch) {
    const existing = this.state.byKey.get(event.key);
    if (existing !== undefined) {
      const target = this.state.nodes[existing].props;
      const result = applyPatch(target, event.patch);
      if (!result.ok) {
        this.opts.onPatchFailure?.(event, result.error);
        return;
      }
      // Rewrite to props form for the reducer
      event = {
        ...event,
        props: result.value as Record<string, unknown>,
        replace: true,
        patch: undefined,
      } as UIReplaceEvent;
    }
  }
  // ...existing reducer dispatch
}
```

The reducer then only sees the `props`-form variant. Clean separation.

### 3.5 React package — devtools summarize

`packages/react/src/devtools/summarize.ts` — when `op === "ui.replace"` and `patch` present, render summary as `replace ${key} (${patch.length} patch ops)` instead of `replace ${key} (${Object.keys(props).length} props)`.

### 3.6 React package — useAgentStream wiring

`packages/react/src/use-agent-stream.ts` — when creating the store, pass `onPatchFailure: (event, error) => onInvalidRef.current?.(event, new Error(`patch apply failed: ${error}`))`.

## 4. File Layout

```
packages/protocol/src/index.ts             # MODIFY — UIReplaceEvent union + JsonPatch types
packages/validate/src/schemas.ts           # MODIFY — superRefine on uiReplaceSchema + jsonPatchOpSchema
packages/react/src/json-patch.ts           # NEW   — pure applier
packages/react/src/reducer.ts              # MODIFY — applyReplace receives props-form only (store pre-applies)
packages/react/src/store.ts                # MODIFY — pre-apply patch; surface failures via onPatchFailure
packages/react/src/use-agent-stream.ts     # MODIFY — wire onPatchFailure → onInvalidEvent
packages/react/src/devtools/summarize.ts   # MODIFY — render patch shape
packages/react/src/index.ts                # MODIFY — export JsonPatch, JsonPatchOp, applyPatch (public)

packages/react/test/json-patch.test.ts     # NEW   — applier unit tests (RFC 6902 conformance subset)
packages/react/test/reducer-patch.test.ts  # NEW   — replace via patch
packages/react/test/store-patch.test.ts    # NEW   — store pre-apply + onPatchFailure
packages/validate/test/ui-replace-patch.test.ts # NEW — schema acceptance / rejection
```

## 5. Testing

### 5.1 `json-patch.test.ts`

- `replace /a/b` updates only `a.b`, leaves siblings by reference (assert `result.value !== target && result.value.c === target.c`)
- `add /items/-` appends to array
- `add /items/2` inserts at index 2, shifting tail
- `remove /items/3` removes index 3
- `move /a/b /a/c` removes `b`, adds at `c`
- `copy /a/b /d` adds at `d` keeping `a/b`
- `test /a/b` against matching value succeeds (no mutation); against mismatch returns error
- Pointer escaping: `~1` → `/`, `~0` → `~`
- Invalid pointer: returns error, target unchanged
- Pointer depth > 32: returns error
- Patch length > 256: caller's responsibility (schema), but applier still works
- All-or-nothing: a 3-op patch where op 2 fails leaves the input untouched and returns the error from op 2

### 5.2 `validate/test/ui-replace-patch.test.ts`

- Valid props-only event → ok
- Valid patch-only event → ok
- Both `props` and `patch` → invalid (`exactly one of`)
- Neither → invalid
- `patch` + `replace: true` → invalid
- Patch with 0 ops → invalid (min(1))
- Patch with 257 ops → invalid (max(256))
- Invalid op kind → invalid
- Invalid pointer (no leading `/` and not empty) → invalid

### 5.3 `reducer-patch.test.ts`

(Tests the store-level pre-apply, since reducer now only sees props-form.)

- Mixed-form sequence: `ui.append` initial → `ui.replace` props → `ui.replace` patch — final state matches expected
- Patch applied to a key not present: store does not call reducer at all; state unchanged; `onPatchFailure` NOT called (consistent with current props-form which is also no-op for unknown keys)

### 5.4 `store-patch.test.ts`

- Successful patch: reducer sees props-form variant with replaced object
- Failed patch (semantic): `onPatchFailure` callback fires with original event + error string
- Failed patch: state remains unchanged
- Without `onPatchFailure`: failures silently drop (no throw)

### 5.5 Integration via useAgentStream

- Stream emits `ui.replace` with patch op `replace /items/3/status` against an existing list node — final state shows updated status
- Stream emits `ui.replace` with patch op `test` that fails — `onInvalidEvent` fires with an Error whose message includes `patch apply failed`

## 6. Documentation

- Update `README.md` with a "Wire protocol — JSON Patch payloads" subsection: when to use `props` vs `patch`, size/perf trade-off, the all-or-nothing semantics.
- `CHANGELOG.md` — v0.8.0 block.

## 7. Out of Scope

- Auto-generating patches client-side from before/after props (host concern).
- Server-side patch derivation utilities (host concern; lives in agent layer, not this library).
- Patches against `children` array (would require structural ops and break the `props`-only path target). Use `ui.append`/`ui.remove` for structural changes.
- Streaming patches mid-event (i.e., `ui.replace-delta`). Possible v0.9 but YAGNI now.
- `optimistic.apply` adopting `patch` field (separate ticket; current `patch: Record<string,unknown>` semantics differ).

## 8. Acceptance Criteria

- `pnpm test` passes including the four new test files.
- `pnpm typecheck` clean across all packages.
- A `ui.replace` event with `patch: [{ op: "replace", path: "/items/3/status", value: "done" }]` updates that one field; siblings of `items[3]` keep referential identity (`result.items[2] === input.items[2]`).
- Invalid patch (semantic failure) does not crash the reducer; `onInvalidEvent` receives an Error with `patch apply failed` in the message.
- The full-`props` form continues to work unchanged; both forms can interleave for the same key.
- README has a JSON Patch subsection; CHANGELOG records v0.8.0.
