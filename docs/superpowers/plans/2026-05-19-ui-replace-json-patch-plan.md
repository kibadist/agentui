# JSON Patch Payloads for `ui.replace` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an alternate JSON Patch payload form to `ui.replace` so agents can emit minimal RFC 6902 deltas instead of full `props` snapshots. Both forms remain valid forever; they can interleave for the same key.

**Architecture:** Three layers change in lockstep:
1. **protocol** — `UIReplaceEvent` becomes a discriminated union over payload shape (`props` vs `patch`). Pure types, no runtime.
2. **validate** — `uiReplaceSchema` keeps `op: ui.replace` as the discriminator (preserves outer `discriminatedUnion("op", ...)` perf) and uses `superRefine` to enforce "exactly one of `props` or `patch`". New `jsonPatchOpSchema`.
3. **react** — new pure `applyPatch` module; `createAgentStore` pre-applies any incoming `patch` and rewrites the event into the `props` form before reducer dispatch. Reducer stays pure and pattern-unaware. Semantic patch failures surface via a new `onPatchFailure` store option, wired from `useAgentStream` to the existing `onInvalidEvent` callback.

**Tech Stack:** TypeScript (ESM), Zod (validate), Vitest (tests). No new runtime deps — the JSON Patch applier is ≤ 200 LOC in-house.

**Version target:** 0.8.0 across all published packages.

---

## File Structure

**New files:**
- `packages/react/src/json-patch.ts` — pure RFC 6902 applier, no deps
- `packages/react/test/json-patch.test.ts` — applier unit tests
- `packages/react/test/store-patch.test.ts` — store pre-apply + failure path
- `packages/validate/test/ui-replace-patch.test.ts` — schema validation
- `packages/react/test/reducer-patch.test.ts` — end-to-end through the store

**Modified files:**
- `packages/protocol/src/index.ts` — split UIReplaceEvent into two interfaces; add JsonPatch types
- `packages/validate/src/schemas.ts` — superRefine on uiReplaceSchema; jsonPointerSchema + jsonPatchOpSchema
- `packages/react/src/store.ts` — pre-apply patch in `send`; surface failure via `onPatchFailure`
- `packages/react/src/reducer.ts` — no behavior change; type signatures only (reducer continues to see props-form)
- `packages/react/src/use-agent-stream.ts` — wire `onPatchFailure` → `onInvalidEvent`
- `packages/react/src/devtools/summarize.ts` — render `(N patch ops)` for patch form
- `packages/react/src/index.ts` — export `applyPatch`, `JsonPatch`, `JsonPatchOp`
- `README.md` — JSON Patch subsection
- `CHANGELOG.md` — v0.8.0 block

---

## Task 1: Protocol types

**Files:**
- Modify: `packages/protocol/src/index.ts:57-65` (replace `UIReplaceEvent`); add new exports

- [ ] **Step 1: Edit `packages/protocol/src/index.ts`** — replace the existing `UIReplaceEvent` interface with the union below, add JSON Patch types, and update the `UIEvent` union exports to include both variants explicitly.

Replace lines 57–65 with:

```ts
export interface UIReplacePropsEvent extends BaseEvent {
  op: "ui.replace";
  /** Key of the node to patch */
  key: string;
  /** New / merged props */
  props: Record<string, unknown>;
  /** If true, fully replace props; if false (default), shallow-merge */
  replace?: boolean;
}

/** RFC 6901 JSON Pointer (e.g. "/items/3/status", or "" for the document root). */
export type JsonPointer = string;

export type JsonPatchOp =
  | { op: "add"; path: JsonPointer; value: unknown }
  | { op: "remove"; path: JsonPointer }
  | { op: "replace"; path: JsonPointer; value: unknown }
  | { op: "move"; from: JsonPointer; path: JsonPointer }
  | { op: "copy"; from: JsonPointer; path: JsonPointer }
  | { op: "test"; path: JsonPointer; value: unknown };

export type JsonPatch = JsonPatchOp[];

export interface UIReplacePatchEvent extends BaseEvent {
  op: "ui.replace";
  /** Key of the node to patch */
  key: string;
  /** RFC 6902 JSON Patch operations applied against the node's props */
  patch: JsonPatch;
}

export type UIReplaceEvent = UIReplacePropsEvent | UIReplacePatchEvent;
```

Then locate the `UIEvent` union (lines 94–100) and keep it as is — `UIReplaceEvent` is already in the list and its widened union flows through.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @kibadist/agentui-protocol typecheck
pnpm --filter @kibadist/agentui-react typecheck
pnpm --filter @kibadist/agentui-validate typecheck
```

Expected: all clean. If `applyReplace` in `reducer.ts` fails because `e.props` is now optional on the union, that's expected; Task 4 fixes it. For now: temporarily widen its body to handle the patch case as a no-op so the workspace typechecks:

```ts
function applyReplace(state: AgentState, e: UIReplaceEvent): AgentState {
  const idx = state.byKey.get(e.key);
  if (idx === undefined) return state;
  if ("patch" in e) return state; // handled by store pre-apply (Task 4)
  const nodes = [...state.nodes];
  const existing = nodes[idx];
  nodes[idx] = {
    ...existing,
    props: e.replace ? { ...e.props } : { ...existing.props, ...e.props },
  };
  return { ...state, nodes, byKey: rebuildIndex(nodes) };
}
```

(Touch only the body — leave the signature alone.)

- [ ] **Step 3: Re-run typecheck**

```bash
pnpm typecheck
```

Expected: clean across the workspace.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts packages/react/src/reducer.ts
git commit -m "feat(protocol): UIReplaceEvent supports JsonPatch payload (DET-151)"
```

---

## Task 2: Validate schema

**Files:**
- Modify: `packages/validate/src/schemas.ts:49-54` (replace `uiReplaceSchema`)
- Create: `packages/validate/test/ui-replace-patch.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/validate/test/ui-replace-patch.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { uiEventSchema } from "../src/schemas.js";

const base = {
  v: 1 as const,
  id: "e1",
  ts: "2026-05-19T00:00:00Z",
  sessionId: "s1",
  op: "ui.replace" as const,
  key: "node-1",
};

describe("uiReplaceSchema with JSON Patch", () => {
  it("accepts a props-only event", () => {
    const result = uiEventSchema.safeParse({ ...base, props: { a: 1 } });
    expect(result.success).toBe(true);
  });

  it("accepts a patch-only event", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "replace", path: "/a", value: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects events with both props and patch", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      props: { a: 1 },
      patch: [{ op: "replace", path: "/a", value: 2 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects events with neither props nor patch", () => {
    const result = uiEventSchema.safeParse(base);
    expect(result.success).toBe(false);
  });

  it("rejects patch combined with replace flag", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "replace", path: "/a", value: 2 }],
      replace: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty patch array", () => {
    const result = uiEventSchema.safeParse({ ...base, patch: [] });
    expect(result.success).toBe(false);
  });

  it("rejects patch with more than 256 ops", () => {
    const ops = Array.from({ length: 257 }, (_, i) => ({
      op: "replace" as const,
      path: `/items/${i}`,
      value: i,
    }));
    const result = uiEventSchema.safeParse({ ...base, patch: ops });
    expect(result.success).toBe(false);
  });

  it("rejects invalid op kind", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "splat" as unknown as "add", path: "/a", value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid pointer (no leading slash, not empty)", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "replace", path: "a/b", value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty pointer (document root)", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "replace", path: "", value: { a: 1 } }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts move/copy with from and path", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [
        { op: "move", from: "/a", path: "/b" },
        { op: "copy", from: "/b", path: "/c" },
      ],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kibadist/agentui-validate test ui-replace-patch
```

Expected: most cases fail because the schema doesn't yet accept `patch`.

- [ ] **Step 3: Update the schema**

In `packages/validate/src/schemas.ts`, replace lines 49–54 (`uiReplaceSchema`) with:

```ts
const jsonPointerSchema = z.string().regex(/^$|^(\/([^/~]|~0|~1)*)+$/, "invalid JSON Pointer");

const jsonPatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: jsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal("remove"), path: jsonPointerSchema }),
  z.object({ op: z.literal("replace"), path: jsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal("move"), from: jsonPointerSchema, path: jsonPointerSchema }),
  z.object({ op: z.literal("copy"), from: jsonPointerSchema, path: jsonPointerSchema }),
  z.object({ op: z.literal("test"), path: jsonPointerSchema, value: z.unknown() }),
]);

const uiReplaceSchema = baseEventSchema
  .extend({
    op: z.literal("ui.replace"),
    key: z.string().min(1).max(256),
    props: z.record(z.string(), z.any()).optional(),
    replace: z.boolean().optional(),
    patch: z.array(jsonPatchOpSchema).min(1).max(256).optional(),
  })
  .superRefine((val, ctx) => {
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

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @kibadist/agentui-validate test ui-replace-patch
```

Expected: all 12 cases pass.

- [ ] **Step 5: Make sure no existing test regressed**

```bash
pnpm --filter @kibadist/agentui-validate test
pnpm typecheck
```

Expected: green.

Note: `superRefine` returns a `ZodEffects`, not a `ZodObject`. The outer `discriminatedUnion("op", [...])` in `uiEventSchema` and `agentWireEventSchema` may complain. If so, the fix is straightforward: switch those two unions from `discriminatedUnion("op", [...])` to `z.union([...])`. This is allowed because the schemas still self-discriminate via `op: z.literal(...)`. Performance impact is negligible for events this small. Do the switch as part of this step if the typecheck fails.

- [ ] **Step 6: Commit**

```bash
git add packages/validate/src/schemas.ts packages/validate/test/ui-replace-patch.test.ts
git commit -m "feat(validate): superRefine ui.replace for props/patch exclusivity (DET-151)"
```

---

## Task 3: JSON Patch applier

**Files:**
- Create: `packages/react/src/json-patch.ts`
- Create: `packages/react/test/json-patch.test.ts`

- [ ] **Step 1: Write the failing tests** at `packages/react/test/json-patch.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { applyPatch } from "../src/json-patch.js";

describe("applyPatch", () => {
  describe("replace op", () => {
    it("replaces a leaf value, preserves siblings by reference", () => {
      const target = { a: { b: 1, c: { d: 2 } }, e: [10, 20] };
      const result = applyPatch(target, [{ op: "replace", path: "/a/b", value: 99 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const v = result.value as typeof target;
      expect(v.a.b).toBe(99);
      expect(v.a.c).toBe(target.a.c);   // referential identity preserved
      expect(v.e).toBe(target.e);
      expect(target.a.b).toBe(1);       // input not mutated
    });

    it("replaces the entire document with empty pointer", () => {
      const target = { a: 1 };
      const result = applyPatch(target, [{ op: "replace", path: "", value: { b: 2 } }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ b: 2 });
    });

    it("fails on non-existent path", () => {
      const target = { a: 1 };
      const result = applyPatch(target, [{ op: "replace", path: "/missing", value: 1 }]);
      expect(result.ok).toBe(false);
    });
  });

  describe("add op", () => {
    it("adds a new object property", () => {
      const result = applyPatch({ a: 1 }, [{ op: "add", path: "/b", value: 2 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ a: 1, b: 2 });
    });

    it("inserts into an array at index", () => {
      const result = applyPatch({ items: [1, 2, 4] }, [{ op: "add", path: "/items/2", value: 3 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ items: [1, 2, 3, 4] });
    });

    it("appends with end-array sentinel '-'", () => {
      const result = applyPatch({ items: [1, 2] }, [{ op: "add", path: "/items/-", value: 3 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ items: [1, 2, 3] });
    });

    it("fails on non-existent parent path", () => {
      const result = applyPatch({ a: 1 }, [{ op: "add", path: "/missing/x", value: 1 }]);
      expect(result.ok).toBe(false);
    });
  });

  describe("remove op", () => {
    it("removes an object property", () => {
      const result = applyPatch({ a: 1, b: 2 }, [{ op: "remove", path: "/a" }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ b: 2 });
    });

    it("removes an array element by index", () => {
      const result = applyPatch({ items: [1, 2, 3] }, [{ op: "remove", path: "/items/1" }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ items: [1, 3] });
    });

    it("fails on non-existent path", () => {
      const result = applyPatch({ a: 1 }, [{ op: "remove", path: "/missing" }]);
      expect(result.ok).toBe(false);
    });
  });

  describe("move op", () => {
    it("moves value from one path to another", () => {
      const result = applyPatch({ a: 1, b: 2 }, [{ op: "move", from: "/a", path: "/c" }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ b: 2, c: 1 });
    });
  });

  describe("copy op", () => {
    it("copies value, keeping source", () => {
      const result = applyPatch({ a: { x: 1 } }, [{ op: "copy", from: "/a", path: "/b" }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ a: { x: 1 }, b: { x: 1 } });
    });
  });

  describe("test op", () => {
    it("succeeds with matching value and does not mutate", () => {
      const target = { a: 1 };
      const result = applyPatch(target, [{ op: "test", path: "/a", value: 1 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ a: 1 });
    });

    it("fails on value mismatch", () => {
      const result = applyPatch({ a: 1 }, [{ op: "test", path: "/a", value: 2 }]);
      expect(result.ok).toBe(false);
    });

    it("uses deep equality for objects", () => {
      const result = applyPatch({ a: { x: 1, y: 2 } }, [
        { op: "test", path: "/a", value: { x: 1, y: 2 } },
      ]);
      expect(result.ok).toBe(true);
    });
  });

  describe("pointer escaping", () => {
    it("unescapes ~1 to /", () => {
      const result = applyPatch({ "a/b": 1 }, [{ op: "replace", path: "/a~1b", value: 2 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ "a/b": 2 });
    });

    it("unescapes ~0 to ~", () => {
      const result = applyPatch({ "a~b": 1 }, [{ op: "replace", path: "/a~0b", value: 2 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ "a~b": 2 });
    });
  });

  describe("all-or-nothing", () => {
    it("aborts on a failing op, leaving input untouched", () => {
      const target = { a: 1, b: 2 };
      const result = applyPatch(target, [
        { op: "replace", path: "/a", value: 10 },
        { op: "test", path: "/b", value: 999 },  // will fail
        { op: "replace", path: "/b", value: 20 },
      ]);
      expect(result.ok).toBe(false);
      expect(target).toEqual({ a: 1, b: 2 });    // input unchanged
    });
  });

  describe("depth limit", () => {
    it("rejects pointers deeper than 32 segments", () => {
      const path = "/" + Array.from({ length: 33 }, (_, i) => `s${i}`).join("/");
      const result = applyPatch({}, [{ op: "replace", path, value: 1 }]);
      expect(result.ok).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kibadist/agentui-react test json-patch
```

Expected: file doesn't exist; tests fail.

- [ ] **Step 3: Implement the applier** at `packages/react/src/json-patch.ts`

```ts
import type { JsonPatchOp } from "@kibadist/agentui-protocol";

export type ApplyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

const MAX_DEPTH = 32;

function parsePointer(pointer: string): string[] | { error: string } {
  if (pointer === "") return [];
  if (pointer[0] !== "/") return { error: `invalid pointer: ${pointer}` };
  const parts = pointer.slice(1).split("/");
  if (parts.length > MAX_DEPTH) return { error: `pointer depth exceeds ${MAX_DEPTH}` };
  return parts.map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
  }
  return false;
}

function isArrayIndex(seg: string, len: number, forAdd: boolean): number | null {
  if (forAdd && seg === "-") return len;
  if (!/^(0|[1-9][0-9]*)$/.test(seg)) return null;
  const n = Number(seg);
  if (n > 100_000) return null;
  if (forAdd ? n > len : n >= len) return null;
  return n;
}

function getAt(value: unknown, path: string[]): { ok: true; value: unknown } | { ok: false; error: string } {
  let cur = value;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (Array.isArray(cur)) {
      const idx = isArrayIndex(seg, cur.length, false);
      if (idx === null) return { ok: false, error: `bad array index "${seg}"` };
      cur = cur[idx];
    } else if (cur !== null && typeof cur === "object") {
      const obj = cur as Record<string, unknown>;
      if (!(seg in obj)) return { ok: false, error: `path not found: /${path.slice(0, i + 1).join("/")}` };
      cur = obj[seg];
    } else {
      return { ok: false, error: `cannot traverse into primitive at /${path.slice(0, i).join("/")}` };
    }
  }
  return { ok: true, value: cur };
}

function setAt(
  value: unknown,
  path: string[],
  newValue: unknown,
  mode: "add" | "replace",
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (path.length === 0) return { ok: true, value: newValue };
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const arr = [...value];
    if (rest.length === 0) {
      const idx = isArrayIndex(head, arr.length, mode === "add");
      if (idx === null) return { ok: false, error: `bad array index "${head}"` };
      if (mode === "add") arr.splice(idx, 0, newValue);
      else arr[idx] = newValue;
      return { ok: true, value: arr };
    }
    const idx = isArrayIndex(head, arr.length, false);
    if (idx === null) return { ok: false, error: `bad array index "${head}"` };
    const inner = setAt(arr[idx], rest, newValue, mode);
    if (!inner.ok) return inner;
    arr[idx] = inner.value;
    return { ok: true, value: arr };
  }
  if (value !== null && typeof value === "object") {
    const obj = { ...(value as Record<string, unknown>) };
    if (rest.length === 0) {
      if (mode === "replace" && !(head in obj)) {
        return { ok: false, error: `path not found: /${head}` };
      }
      obj[head] = newValue;
      return { ok: true, value: obj };
    }
    if (!(head in obj)) return { ok: false, error: `path not found: /${head}` };
    const inner = setAt(obj[head], rest, newValue, mode);
    if (!inner.ok) return inner;
    obj[head] = inner.value;
    return { ok: true, value: obj };
  }
  return { ok: false, error: `cannot traverse into primitive` };
}

function removeAt(value: unknown, path: string[]): { ok: true; value: unknown } | { ok: false; error: string } {
  if (path.length === 0) return { ok: false, error: "cannot remove root" };
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const arr = [...value];
    const idx = isArrayIndex(head, arr.length, false);
    if (idx === null) return { ok: false, error: `bad array index "${head}"` };
    if (rest.length === 0) {
      arr.splice(idx, 1);
      return { ok: true, value: arr };
    }
    const inner = removeAt(arr[idx], rest);
    if (!inner.ok) return inner;
    arr[idx] = inner.value;
    return { ok: true, value: arr };
  }
  if (value !== null && typeof value === "object") {
    const obj = { ...(value as Record<string, unknown>) };
    if (!(head in obj)) return { ok: false, error: `path not found: /${head}` };
    if (rest.length === 0) {
      delete obj[head];
      return { ok: true, value: obj };
    }
    const inner = removeAt(obj[head], rest);
    if (!inner.ok) return inner;
    obj[head] = inner.value;
    return { ok: true, value: obj };
  }
  return { ok: false, error: `cannot traverse into primitive` };
}

function applyOp(value: unknown, op: JsonPatchOp): { ok: true; value: unknown } | { ok: false; error: string } {
  const path = parsePointer(op.path);
  if ("error" in path) return { ok: false, error: path.error };
  switch (op.op) {
    case "add":
      return setAt(value, path, op.value, "add");
    case "replace":
      return setAt(value, path, op.value, "replace");
    case "remove":
      return removeAt(value, path);
    case "test": {
      const got = getAt(value, path);
      if (!got.ok) return got;
      if (!deepEqual(got.value, op.value)) {
        return { ok: false, error: `test failed at ${op.path}` };
      }
      return { ok: true, value };
    }
    case "move": {
      const from = parsePointer(op.from);
      if ("error" in from) return { ok: false, error: from.error };
      const got = getAt(value, from);
      if (!got.ok) return got;
      const removed = removeAt(value, from);
      if (!removed.ok) return removed;
      return setAt(removed.value, path, got.value, "add");
    }
    case "copy": {
      const from = parsePointer(op.from);
      if ("error" in from) return { ok: false, error: from.error };
      const got = getAt(value, from);
      if (!got.ok) return got;
      return setAt(value, path, got.value, "add");
    }
  }
}

export function applyPatch(target: unknown, patch: JsonPatchOp[]): ApplyResult {
  let cur = target;
  for (const op of patch) {
    const result = applyOp(cur, op);
    if (!result.ok) return result;
    cur = result.value;
  }
  return { ok: true, value: cur };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @kibadist/agentui-react test json-patch
```

Expected: all cases pass.

- [ ] **Step 5: Export from the public API** — edit `packages/react/src/index.ts` (add near the top with the registry exports):

```ts
export { applyPatch } from "./json-patch.js";
export type { ApplyResult } from "./json-patch.js";
export type { JsonPatch, JsonPatchOp, JsonPointer, UIReplacePropsEvent, UIReplacePatchEvent } from "@kibadist/agentui-protocol";
```

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/json-patch.ts packages/react/test/json-patch.test.ts packages/react/src/index.ts
git commit -m "feat(react): add applyPatch (RFC 6902 subset) and re-exports (DET-151)"
```

---

## Task 4: Store pre-apply

**Files:**
- Modify: `packages/react/src/store.ts`
- Modify: `packages/react/src/reducer.ts` — restore clean `applyReplace` body (remove the Task 1 `"patch" in e` guard)
- Create: `packages/react/test/store-patch.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/react/test/store-patch.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { createAgentStore } from "../src/store.js";
import type { UIAppendEvent, UIReplaceEvent } from "@kibadist/agentui-protocol";

function append(key: string, props: Record<string, unknown>): UIAppendEvent {
  return {
    v: 1, id: `a-${key}`, ts: "t", sessionId: "s",
    op: "ui.append",
    node: { key, type: "Card", props },
  };
}

function patch(key: string, ops: UIReplaceEvent["patch"]): UIReplaceEvent {
  return {
    v: 1, id: `r-${key}`, ts: "t", sessionId: "s",
    op: "ui.replace", key, patch: ops,
  } as UIReplaceEvent;
}

describe("createAgentStore — JSON Patch pre-apply", () => {
  it("applies patch to existing node's props", () => {
    const store = createAgentStore();
    store.send(append("n1", { items: [{ status: "todo" }, { status: "todo" }, { status: "todo" }] }));
    store.send(patch("n1", [{ op: "replace", path: "/items/1/status", value: "done" }]));
    const state = store.getState();
    expect(state.nodes[0].props).toEqual({
      items: [{ status: "todo" }, { status: "done" }, { status: "todo" }],
    });
  });

  it("calls onPatchFailure on semantic failure and leaves state unchanged", () => {
    const onPatchFailure = vi.fn();
    const store = createAgentStore({ onPatchFailure });
    store.send(append("n1", { a: 1 }));
    const evt = patch("n1", [{ op: "test", path: "/a", value: 999 }]);
    store.send(evt);
    expect(onPatchFailure).toHaveBeenCalledTimes(1);
    expect(onPatchFailure.mock.calls[0][0]).toBe(evt);
    expect(store.getState().nodes[0].props).toEqual({ a: 1 });
  });

  it("is a silent no-op when the key is not in state", () => {
    const onPatchFailure = vi.fn();
    const store = createAgentStore({ onPatchFailure });
    store.send(patch("missing", [{ op: "replace", path: "/a", value: 1 }]));
    expect(onPatchFailure).not.toHaveBeenCalled();
    expect(store.getState().nodes).toEqual([]);
  });

  it("does not throw when onPatchFailure is undefined", () => {
    const store = createAgentStore();
    store.send(append("n1", { a: 1 }));
    expect(() =>
      store.send(patch("n1", [{ op: "test", path: "/a", value: 999 }])),
    ).not.toThrow();
  });

  it("mixed props/patch sequence converges correctly", () => {
    const store = createAgentStore();
    store.send(append("n1", { a: 1, b: 2 }));
    store.send({
      v: 1, id: "r1", ts: "t", sessionId: "s",
      op: "ui.replace", key: "n1", props: { c: 3 },
    } as UIReplaceEvent);
    store.send(patch("n1", [{ op: "remove", path: "/a" }]));
    expect(store.getState().nodes[0].props).toEqual({ b: 2, c: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kibadist/agentui-react test store-patch
```

Expected: tests fail (no `onPatchFailure` option; patch events not handled).

- [ ] **Step 3: Update `packages/react/src/store.ts`**

Read the file first. Then:

1. Add `onPatchFailure?: (event: UIReplaceEvent, error: string) => void` to `CreateAgentStoreOptions`.
2. In the `send(event)` method, before dispatching to the reducer, add a guard:

```ts
if (event.op === "ui.replace" && "patch" in event && event.patch) {
  const state = this.state; // or whatever the field is
  const idx = state.byKey.get(event.key);
  if (idx !== undefined) {
    const target = state.nodes[idx].props;
    const result = applyPatch(target, event.patch);
    if (!result.ok) {
      this.opts?.onPatchFailure?.(event, result.error);
      return;
    }
    event = {
      v: event.v,
      id: event.id,
      ts: event.ts,
      sessionId: event.sessionId,
      op: "ui.replace",
      key: event.key,
      props: result.value as Record<string, unknown>,
      replace: true,
    };
  }
}
```

Import `applyPatch` from `./json-patch.js` and types as needed.

3. Restore `applyReplace` in `reducer.ts` to its original clean body (remove the `"patch" in e` guard added in Task 1) — the reducer is once again guaranteed to receive only the `props` form.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @kibadist/agentui-react test store-patch
pnpm --filter @kibadist/agentui-react test
```

Expected: green; no regressions in the rest of the React test suite.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/store.ts packages/react/src/reducer.ts packages/react/test/store-patch.test.ts
git commit -m "feat(react): pre-apply JSON Patch in store; onPatchFailure callback (DET-151)"
```

---

## Task 5: useAgentStream wiring + devtools summary

**Files:**
- Modify: `packages/react/src/use-agent-stream.ts` — pass `onPatchFailure` to `createAgentStore`
- Modify: `packages/react/src/devtools/summarize.ts` — render patch op count
- Create: `packages/react/test/reducer-patch.test.ts` — integration sanity

- [ ] **Step 1: Update `use-agent-stream.ts`**

Read the file. In the `useEffect` where the store is constructed, replace:

```ts
if (storeRef.current === null) storeRef.current = createAgentStore({ caps });
```

with:

```ts
if (storeRef.current === null) {
  storeRef.current = createAgentStore({
    caps,
    onPatchFailure: (event, error) =>
      onInvalidRef.current?.(event, new Error(`patch apply failed: ${error}`)),
  });
}
```

- [ ] **Step 2: Update `devtools/summarize.ts`**

For the `ui.replace` case, change the summary text to detect the variant. Read the file to find current shape, then return something like:

```ts
case "ui.replace":
  return "patch" in event && event.patch
    ? `replace ${event.key} (${event.patch.length} patch ops)`
    : `replace ${event.key} (${Object.keys(event.props ?? {}).length} props)`;
```

(Adapt to the file's actual return-shape convention.)

- [ ] **Step 3: Write the integration test** at `packages/react/test/reducer-patch.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentStream } from "../src/use-agent-stream.js";
import type { UIAppendEvent, UIReplaceEvent } from "@kibadist/agentui-protocol";

describe("useAgentStream + JSON Patch (via store)", () => {
  it("dispatch with patch event updates the corresponding node", () => {
    const { result } = renderHook(() =>
      useAgentStream({ url: "http://localhost/_unused", sessionId: "s", enabled: false }),
    );
    const append: UIAppendEvent = {
      v: 1, id: "a", ts: "t", sessionId: "s",
      op: "ui.append",
      node: { key: "n1", type: "Card", props: { tags: ["a", "b", "c"] } },
    };
    const patch: UIReplaceEvent = {
      v: 1, id: "r", ts: "t", sessionId: "s",
      op: "ui.replace", key: "n1",
      patch: [{ op: "replace", path: "/tags/1", value: "B" }],
    };
    act(() => {
      result.current.dispatch(append);
      result.current.dispatch(patch);
    });
    expect(result.current.state.nodes[0].props).toEqual({ tags: ["a", "B", "c"] });
  });

  it("dispatch with semantically-failing patch surfaces onInvalidEvent", () => {
    const onInvalidEvent = vi.fn();
    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://localhost/_unused",
        sessionId: "s",
        enabled: false,
        onInvalidEvent,
      }),
    );
    act(() => {
      result.current.dispatch({
        v: 1, id: "a", ts: "t", sessionId: "s",
        op: "ui.append",
        node: { key: "n1", type: "Card", props: { a: 1 } },
      });
      result.current.dispatch({
        v: 1, id: "r", ts: "t", sessionId: "s",
        op: "ui.replace", key: "n1",
        patch: [{ op: "test", path: "/a", value: 999 }],
      });
    });
    expect(onInvalidEvent).toHaveBeenCalledTimes(1);
    expect(onInvalidEvent.mock.calls[0][1].message).toContain("patch apply failed");
  });
});
```

(Add `import { vi } from "vitest";` at the top.)

- [ ] **Step 4: Run all React tests**

```bash
pnpm --filter @kibadist/agentui-react test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/use-agent-stream.ts packages/react/src/devtools/summarize.ts packages/react/test/reducer-patch.test.ts
git commit -m "feat(react): wire useAgentStream + devtools to JSON Patch failures (DET-151)"
```

---

## Task 6: Docs + changelog + final verification

**Files:**
- Modify: `README.md` — JSON Patch subsection
- Modify: `CHANGELOG.md` — v0.8.0 block

- [ ] **Step 1: Add a `## JSON Patch payloads for ui.replace` section to `README.md`**

Read the README to find an appropriate location (likely near the wire-protocol or "What's new" area). Add:

```markdown
### JSON Patch payloads for `ui.replace`

For deeply nested or large nodes, agents can emit minimal [RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) JSON Patch deltas instead of full props snapshots:

```ts
{
  op: "ui.replace",
  key: "todo-list",
  patch: [
    { op: "replace", path: "/items/3/status", value: "done" }
  ]
}
```

- Paths target the node's `props` object (root `""` means props itself).
- All ops are supported: `add`, `remove`, `replace`, `move`, `copy`, `test`.
- All-or-nothing: any failing op aborts the patch and surfaces via `onInvalidEvent`.
- Use full `props` for simple updates; use `patch` when the diff is small relative to the node.

Both forms can interleave for the same key.
```

- [ ] **Step 2: Add a `## 0.8.0` block to `CHANGELOG.md`** at the top of the version list:

```markdown
## 0.8.0 — 2026-05-19

### Added
- `ui.replace` events now accept an alternate `patch` payload (RFC 6902 JSON Patch). Lets agents emit minimal deltas for deeply nested nodes. Both `props` and `patch` forms remain valid and can interleave for the same key. ([DET-151](https://linear.app/detailing-app/issue/DET-151))
- New `applyPatch` helper exported from `@kibadist/agentui-react` for in-process patch application.
- New `onPatchFailure` option on `createAgentStore`; `useAgentStream` wires it into `onInvalidEvent`.
- New protocol exports: `JsonPatch`, `JsonPatchOp`, `JsonPointer`, `UIReplacePropsEvent`, `UIReplacePatchEvent`.
```

- [ ] **Step 3: Full verification**

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 4: Commit docs**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: JSON Patch payloads for ui.replace (DET-151)"
```

---

## Self-Review Checklist

After completing all tasks:

- [ ] **Spec coverage:** every numbered section in the spec (`docs/superpowers/specs/2026-05-19-ui-replace-json-patch-design.md`) is implemented or has a task pointing at it.
- [ ] **Public API:** `applyPatch`, `JsonPatch`, `JsonPatchOp`, `JsonPointer`, `UIReplacePropsEvent`, `UIReplacePatchEvent`, and `ApplyResult` are exported from the appropriate packages.
- [ ] **Failure paths:** semantic patch failures (test mismatch, bad path) reach `onInvalidEvent` with `patch apply failed: …` in the message. Unknown-key patches are silent no-ops (matches existing props-form behavior).
- [ ] **No regressions:** the existing props-form `ui.replace` (with `replace: true` and shallow-merge default) behaves identically.
- [ ] **Discriminated union still discriminates by `op`:** `uiEventSchema` / `agentWireEventSchema` parse path is preserved; performance neutral.
