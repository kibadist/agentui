---
ticket: DET-147
title: Schema-first node definitions (defineNode + Zod inference)
version_target: 0.6.4
date: 2026-05-19
---

# Schema-First Nodes — Design Spec

## 1. Goal

Make Zod schemas the source of truth for node types. One `defineNode({ type, schema, component, requires })` call drives:

1. The component's props type (via `z.infer<typeof schema>`)
2. Runtime validation of props at emit time (`Node.build({ props })` throws on shape mismatch)
3. Registry registration without restating the type key

The old `createRegistry({ "type": { component, propsSchema } })` object form keeps working unchanged.

## 2. Public API

### 2.1 `defineNode`

```ts
import { z } from "zod";
import type { ComponentType } from "react";
import type { UINode } from "@kibadist/agentui-protocol";

export interface DefineNodeOptions<TSchema extends z.ZodObject<z.ZodRawShape>> {
  type: string;
  schema: TSchema;
  component: ComponentType<z.infer<TSchema>>;
  /** Optional capability requirements; propagated to UINode.meta.requires on .build(). */
  requires?: string[];
}

export interface BuildArgs<TSchema extends z.ZodObject<z.ZodRawShape>> {
  key: string;
  props: z.infer<TSchema>;
  slot?: string;
  /** Optional extra meta. Merged with auto-derived requires. */
  meta?: Omit<NonNullable<UINode["meta"]>, "requires">;
}

export interface NodeDefinition<TSchema extends z.ZodObject<z.ZodRawShape>> {
  readonly type: string;
  readonly schema: TSchema;
  readonly component: ComponentType<z.infer<TSchema>>;
  readonly requires: readonly string[] | undefined;
  /** Build a UINode wire payload. Validates props against `schema`; throws on failure. */
  build(args: BuildArgs<TSchema>): UINode;
}

export function defineNode<TSchema extends z.ZodObject<z.ZodRawShape>>(
  opts: DefineNodeOptions<TSchema>,
): NodeDefinition<TSchema>;
```

### 2.2 `createRegistry` (overload)

```ts
// Existing — unchanged
export function createRegistry(map: Record<string, ComponentSpec>): Registry;

// New
export function createRegistry(nodes: NodeDefinition<any>[]): Registry;
```

Internal implementation discriminates at runtime: `Array.isArray(input)` → iterate definitions; else → iterate object entries. Both paths produce the same `Registry` interface — `get(type)`, `has(type)`, `types()`.

When converting a `NodeDefinition` to a `ComponentSpec` for storage:
- `component` → `ComponentSpec.component`
- `schema` → `ComponentSpec.propsSchema`
- `requires` → `ComponentSpec.requires`

### 2.3 Usage example

```ts
import { z } from "zod";
import { defineNode, createRegistry } from "@kibadist/agentui-react";
import { QuoteCard } from "./quote-card";

const QuoteCardNode = defineNode({
  type: "quote-card",
  schema: z.object({
    quoteId: z.string(),
    status: z.enum(["new_lead", "pending", "scheduled"]),
    total: z.number(),
  }),
  component: QuoteCard,
  requires: ["quotes.read"],
});

export const registry = createRegistry([QuoteCardNode /*, …*/]);

// Server / agent side:
emit({
  op: "ui.append",
  node: QuoteCardNode.build({
    key: "quote-123",
    props: { quoteId: "Q-123", status: "pending", total: 1200 },
  }),
});
// Type error: `propxs: { quoteId: 5 }` because quoteId expects string.
// Runtime error: `.build({ props: { quoteId: 5, ... } })` throws with the Zod error path.
```

## 3. Validation Behavior

### 3.1 `build()` runtime validation

`NodeDefinition.build()` calls `schema.safeParse(props)`:
- On success: returns `{ key, type, props: parsed.data, slot, meta: { ...userMeta, requires: this.requires } }`
- On failure: throws `Error` with message `"defineNode(${type}).build: invalid props\n${zodError.message}"`

The thrown error is a plain `Error` (no custom class) — the user-facing surface stays small. The Zod issues array is JSON-stringified into the message so the path is visible.

### 3.2 Schema constraints

- `schema` must be a `z.ZodObject` (object root), not any other Zod type. Rationale: UINode.props is `Record<string, unknown>`, so a top-level object is the only well-defined shape.
- Type system enforces this: `TSchema extends z.ZodObject<z.ZodRawShape>`.

### 3.3 `meta.requires` derivation

If `defineNode({ requires })` is provided, every `build()` sets `meta.requires` to that array. The caller can pass `meta: { ttlMs: 5000 }` but not `meta.requires` (TypeScript blocks via the `Omit<…, "requires">` in `BuildArgs`).

If `requires` is undefined on the definition, `meta.requires` is undefined (not set).

## 4. Back-Compat

Existing call sites untouched:

```ts
// Still works — object form preserved
createRegistry({
  "text-block": { component: TextBlock, propsSchema: textBlockSchema },
  "info-card": { component: InfoCard, propsSchema: infoCardSchema },
});
```

`Registry.get(type)` returns identical `ComponentSpec` shapes regardless of which form was used. Renderer, store, and consumers don't notice.

Mixing forms in one registry is **not supported** in v0.6.4. If you call `createRegistry([])`, all entries must be `NodeDefinition`. If you call `createRegistry({})`, all entries must be the legacy spec shape. A mixed input is a TS error.

## 5. Dependencies

### 5.1 zod as peer dependency

`@kibadist/agentui-react` currently has no zod dep — it uses a structural `ZodLike` interface. v0.6.4 keeps `ZodLike` for the legacy `ComponentSpec.propsSchema`, but adds `zod` as an **optional peer dependency** so that `defineNode` can type-correctly accept a `z.ZodObject` and use `z.infer<>`.

`package.json`:

```json
{
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "zod": "^3.23.0"
  },
  "peerDependenciesMeta": {
    "zod": { "optional": true }
  }
}
```

Source uses type-only import: `import type { z } from "zod";`. This matches the pattern already in `@kibadist/agentui-validate`. Consumers who never call `defineNode` and never set up the legacy `propsSchema` don't need zod at runtime.

### 5.2 No runtime imports

`defineNode` runs zero zod code at module-init. The only zod call is `schema.safeParse(props)` inside `build()` — which the caller already has zod for (they passed it in).

## 6. File Layout

```
packages/react/src/
├── registry.ts                   # MODIFY — overload createRegistry, no API break
├── define-node.ts                # NEW — defineNode() + NodeDefinition + BuildArgs
└── index.ts                      # MODIFY — re-export defineNode + types
```

`registry.ts` grows a small `isNodeDefinitionArray()` discriminator and a `nodeDefinitionToSpec()` helper, both kept inside the file.

## 7. Testing

### 7.1 Unit tests (`packages/react/test/define-node.test.ts`)

- `defineNode` returns an object with `type`, `schema`, `component`, `requires`, `build` properties.
- `build({ key, props })` returns a UINode with `key`, `type`, validated `props`, and `meta.requires` when set.
- `build({ key, props: invalidProps })` throws an Error with message containing `"invalid props"` and the failing field path.
- `build({ key, props, slot: "main" })` propagates the slot.
- `build({ key, props, meta: { ttlMs: 1000 } })` merges meta with derived requires.
- Calling `build` without `requires` on the definition omits `meta.requires` (not `meta: { requires: undefined }`).

### 7.2 Registry overload tests (`packages/react/test/registry-define-node.test.ts`)

- `createRegistry([Node1, Node2])` produces a registry where `get("type1")` returns the corresponding `ComponentSpec`.
- Same registry from the object form (`createRegistry({ type1: { component, propsSchema } })`) is equivalent in observable behavior.
- `createRegistry([])` returns an empty registry.
- Array containing duplicate `type` strings throws (last wins is wrong here — strict).

### 7.3 Type-level tests (`packages/react/test/define-node.test-d.ts` — vitest expectTypeOf)

Using `expectTypeOf` from vitest (already in the dev stack via vitest 2.x):

- `defineNode({ schema: z.object({ a: z.string() }), component, type })` infers component props as `{ a: string }`.
- `Node.build({ key, props: { a: 1 } })` — props mismatch is a TS error (assert with `// @ts-expect-error`).
- `Node.build({ key, props: { a: "x" }, meta: { requires: ["x"] } })` — meta.requires is forbidden (TS error).

`.test-d.ts` files are picked up by vitest with `typecheck: true` config. If the project's vitest config doesn't have typecheck enabled, this task enables it via the file pattern `**/*.test-d.ts` and adds the necessary tsconfig include.

### 7.4 What we deliberately do NOT test

- Codemod migration (out of scope, separate ticket).
- Mixed object+array `createRegistry` input — type system prevents this; runtime test would just confirm the type guard.
- Performance — `safeParse` cost is the user's choice (they could call build many times).

## 8. Release Mechanics

### 8.1 CHANGELOG

`## 0.6.4` block:

- **Added:** `defineNode({ type, schema, component, requires })` factory in `@kibadist/agentui-react`. Pairs with new `createRegistry([nodes])` array overload.
- **Added:** `zod` as an optional peer dependency of `@kibadist/agentui-react` (only needed when using `defineNode` or the legacy `propsSchema`).
- **Compat:** Existing `createRegistry({ "type": spec })` object form continues to work unchanged.

### 8.2 README

Add a "Schema-first nodes" H3 subsection after the CLI generator section. Show one `defineNode` example + the array `createRegistry` call. Two sentences explaining "schemas are the source of truth; props are type-inferred; emit-time validation is automatic."

## 9. Out of Scope (v0.6.4)

- `@kibadist/agentui-codemods` for auto-migrating object-form → array-form registries
- Server-side helper packages or framework adapters
- Discriminated-union schemas (only `z.ZodObject` roots in v1)
- Per-prop capability requirements (only node-level `requires`)
- Async schema parsing (only sync `safeParse`)
- Decorator syntax / class-based node definitions

## 10. Acceptance Criteria

A reviewer should verify:
- `pnpm test` passes including the new define-node tests
- `pnpm typecheck` passes including `.test-d.ts` type assertions
- The example next-app's existing object-form registry still renders correctly
- A new test file demonstrates the array form rendering the same component
- `npm pack`-ing `@kibadist/agentui-react` shows zod is declared as an optional peer
