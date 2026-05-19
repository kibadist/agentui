# Schema-First Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `defineNode({ type, schema, component, requires })` in `@kibadist/agentui-react` plus an array overload for `createRegistry`, with zero break to the existing object form. Targets v0.6.4.

**Architecture:** New file `packages/react/src/define-node.ts` holds the factory. `packages/react/src/registry.ts` gets a single overload signature plus a runtime discriminator. `zod` is added as an optional peer dependency. Type-level safety verified via vitest's `expectTypeOf` plus `@ts-expect-error` markers in a `.test-d.ts` file (enabled by extending vitest config with `typecheck`).

**Tech Stack:** TypeScript strict, React 18/19, zod (type-only import + optional peer), vitest 2.x with `typecheck` config.

**Reference spec:** `docs/superpowers/specs/2026-05-19-schema-first-nodes-design.md`

---

## File Structure

```
packages/react/
├── package.json                                # MODIFY — add zod optional peer dep
├── src/
│   ├── registry.ts                             # MODIFY — overload createRegistry + adapter
│   ├── define-node.ts                          # NEW — defineNode + NodeDefinition + BuildArgs
│   └── index.ts                                # MODIFY — re-export defineNode + types
└── test/
    ├── define-node.test.ts                     # NEW — runtime behavior tests
    ├── define-node.test-d.ts                   # NEW — type-level assertions
    └── registry-define-node.test.ts            # NEW — array-overload tests
```

Outside the react package:
- `vitest.config.ts` — MODIFY: enable `typecheck` and broaden include for `.test-d.ts`
- `CHANGELOG.md` — add `## 0.6.4`
- `README.md` — add "Schema-first nodes" subsection

The example next-app registry is **not** migrated in this plan (the spec keeps the object form working; a migration would be cosmetic noise for the PR). A new test file in the react package demonstrates the array form against a known component.

---

## Task 0: Add zod as an optional peer dependency

**Files:**
- Modify: `packages/react/package.json`

- [ ] **Step 1: Read current package.json**

Read `/Users/max/agentui/packages/react/package.json` to confirm the current `peerDependencies` block.

- [ ] **Step 2: Add zod under peerDependencies + peerDependenciesMeta**

Update the existing `peerDependencies` block. Find:

```json
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0"
  },
```

Change to:

```json
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "zod": "^3.23.0"
  },
  "peerDependenciesMeta": {
    "zod": { "optional": true }
  },
```

Place `peerDependenciesMeta` immediately after `peerDependencies`.

- [ ] **Step 3: Add zod as a devDependency for build-time type resolution**

Find the `devDependencies` block:

```json
  "devDependencies": {
    "@types/react": "^19.0.8",
    "react": "^19.0.0",
    "typescript": "^5.7.3"
  }
```

Change to:

```json
  "devDependencies": {
    "@types/react": "^19.0.8",
    "react": "^19.0.0",
    "typescript": "^5.7.3",
    "zod": "^3.23.0"
  }
```

- [ ] **Step 4: Install**

```bash
pnpm install
```

Expected: lockfile updates, no errors.

- [ ] **Step 5: Verify typecheck/build still pass**

```bash
pnpm typecheck && pnpm build
```

Expected: all green (nothing imports zod from react yet).

- [ ] **Step 6: Commit**

```bash
git add packages/react/package.json pnpm-lock.yaml
git commit -m "chore(react): add zod as optional peer dependency"
```

---

## Task 1: Enable vitest typecheck mode

**Files:**
- Modify: `vitest.config.ts` (repo root)

- [ ] **Step 1: Read current config**

Current contents:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    globals: false,
  },
});
```

- [ ] **Step 2: Add typecheck configuration**

Replace the config with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    globals: false,
    typecheck: {
      enabled: true,
      include: ["packages/*/test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.base.json",
    },
  },
});
```

The `tsconfig` path points at the workspace base; if no `tsconfig.base.json` exists at the repo root, drop the `tsconfig` line and vitest will discover the nearest tsconfig automatically.

- [ ] **Step 3: Verify by running tests**

```bash
pnpm test
```

Expected: existing tests pass; typecheck mode adds zero test files initially (no `.test-d.ts` yet), so should be a no-op.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "test: enable vitest typecheck mode for .test-d.ts files"
```

---

## Task 2: defineNode factory + NodeDefinition

**Files:**
- Create: `packages/react/src/define-node.ts`
- Create: `packages/react/test/define-node.test.ts`

- [ ] **Step 1: Write failing tests in `packages/react/test/define-node.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineNode } from "../src/define-node.js";
import type { ComponentType } from "react";

const NoopComponent: ComponentType<{ text: string }> = () => null;

describe("defineNode", () => {
  it("returns an object with type, schema, component, requires, build", () => {
    const node = defineNode({
      type: "quote",
      schema: z.object({ text: z.string() }),
      component: NoopComponent,
    });
    expect(node.type).toBe("quote");
    expect(node.component).toBe(NoopComponent);
    expect(typeof node.build).toBe("function");
    expect(node.requires).toBeUndefined();
  });

  it("exposes the requires array from options", () => {
    const node = defineNode({
      type: "quote",
      schema: z.object({ text: z.string() }),
      component: NoopComponent,
      requires: ["quotes.read"],
    });
    expect(node.requires).toEqual(["quotes.read"]);
  });

  describe(".build()", () => {
    const node = defineNode({
      type: "quote",
      schema: z.object({ text: z.string(), count: z.number().optional() }),
      component: NoopComponent,
    });

    it("returns a UINode with validated props", () => {
      const out = node.build({ key: "k1", props: { text: "hi" } });
      expect(out).toEqual({
        key: "k1",
        type: "quote",
        props: { text: "hi" },
      });
    });

    it("propagates slot", () => {
      const out = node.build({ key: "k1", props: { text: "hi" }, slot: "main" });
      expect(out.slot).toBe("main");
    });

    it("merges user meta with derived requires", () => {
      const guarded = defineNode({
        type: "quote",
        schema: z.object({ text: z.string() }),
        component: NoopComponent,
        requires: ["quotes.read"],
      });
      const out = guarded.build({
        key: "k1",
        props: { text: "hi" },
        meta: { ttlMs: 5000 },
      });
      expect(out.meta).toEqual({ ttlMs: 5000, requires: ["quotes.read"] });
    });

    it("omits meta.requires when defineNode has no requires", () => {
      const out = node.build({ key: "k1", props: { text: "hi" }, meta: { ttlMs: 1000 } });
      expect(out.meta).toEqual({ ttlMs: 1000 });
      expect(out.meta && "requires" in out.meta).toBe(false);
    });

    it("returns no meta when neither requires nor user meta provided", () => {
      const out = node.build({ key: "k1", props: { text: "hi" } });
      expect(out.meta).toBeUndefined();
    });

    it("throws with the Zod error path on invalid props", () => {
      // @ts-expect-error — testing runtime, types prevent this
      expect(() => node.build({ key: "k1", props: { text: 5 } })).toThrow(/invalid props/i);
      try {
        // @ts-expect-error
        node.build({ key: "k1", props: {} });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as Error).message).toMatch(/text/);
      }
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @kibadist/agentui-react exec vitest run test/define-node.test.ts
```

Expected: module-resolution error for `../src/define-node.js`.

- [ ] **Step 3: Implement `packages/react/src/define-node.ts`**

```ts
import type { ComponentType } from "react";
import type { z } from "zod";
import type { UINode } from "@kibadist/agentui-protocol";

export interface DefineNodeOptions<TSchema extends z.ZodObject<z.ZodRawShape>> {
  type: string;
  schema: TSchema;
  component: ComponentType<z.infer<TSchema>>;
  requires?: string[];
}

export interface BuildArgs<TSchema extends z.ZodObject<z.ZodRawShape>> {
  key: string;
  props: z.infer<TSchema>;
  slot?: string;
  meta?: Omit<NonNullable<UINode["meta"]>, "requires">;
}

export interface NodeDefinition<TSchema extends z.ZodObject<z.ZodRawShape>> {
  readonly type: string;
  readonly schema: TSchema;
  readonly component: ComponentType<z.infer<TSchema>>;
  readonly requires: readonly string[] | undefined;
  build(args: BuildArgs<TSchema>): UINode;
}

export function defineNode<TSchema extends z.ZodObject<z.ZodRawShape>>(
  opts: DefineNodeOptions<TSchema>,
): NodeDefinition<TSchema> {
  const requires = opts.requires;
  return {
    type: opts.type,
    schema: opts.schema,
    component: opts.component,
    requires,
    build({ key, props, slot, meta }) {
      const parsed = opts.schema.safeParse(props);
      if (!parsed.success) {
        const issues = JSON.stringify(parsed.error.issues, null, 2);
        throw new Error(`defineNode(${opts.type}).build: invalid props\n${issues}`);
      }

      const node: UINode = {
        key,
        type: opts.type,
        props: parsed.data as Record<string, unknown>,
      };
      if (slot !== undefined) node.slot = slot;

      const hasUserMeta = meta !== undefined && Object.keys(meta).length > 0;
      if (requires !== undefined && requires.length > 0) {
        node.meta = { ...(meta ?? {}), requires: [...requires] };
      } else if (hasUserMeta) {
        node.meta = { ...meta };
      }

      return node;
    },
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @kibadist/agentui-react exec vitest run test/define-node.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/define-node.ts packages/react/test/define-node.test.ts
git commit -m "feat(react): defineNode factory with build() validation"
```

---

## Task 3: createRegistry array overload

**Files:**
- Modify: `packages/react/src/registry.ts`
- Create: `packages/react/test/registry-define-node.test.ts`

- [ ] **Step 1: Write failing test in `packages/react/test/registry-define-node.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { ComponentType } from "react";
import { createRegistry } from "../src/registry.js";
import { defineNode } from "../src/define-node.js";

const Comp: ComponentType<{ text: string }> = () => null;

describe("createRegistry — array overload", () => {
  it("registers NodeDefinitions by their type", () => {
    const A = defineNode({ type: "a", schema: z.object({ text: z.string() }), component: Comp });
    const B = defineNode({ type: "b", schema: z.object({ text: z.string() }), component: Comp });
    const r = createRegistry([A, B]);
    expect(r.has("a")).toBe(true);
    expect(r.has("b")).toBe(true);
    expect(r.types().sort()).toEqual(["a", "b"]);
  });

  it("maps NodeDefinition fields into ComponentSpec shape", () => {
    const Node = defineNode({
      type: "a",
      schema: z.object({ text: z.string() }),
      component: Comp,
      requires: ["x.read"],
    });
    const r = createRegistry([Node]);
    const spec = r.get("a");
    expect(spec).toBeDefined();
    expect(spec?.component).toBe(Comp);
    expect(spec?.propsSchema).toBe(Node.schema);
    expect(spec?.requires).toEqual(["x.read"]);
  });

  it("empty array produces an empty registry", () => {
    const r = createRegistry([]);
    expect(r.types()).toEqual([]);
    expect(r.has("anything")).toBe(false);
  });

  it("throws on duplicate type keys in the array", () => {
    const A1 = defineNode({ type: "dup", schema: z.object({ text: z.string() }), component: Comp });
    const A2 = defineNode({ type: "dup", schema: z.object({ text: z.string() }), component: Comp });
    expect(() => createRegistry([A1, A2])).toThrow(/duplicate/i);
  });

  it("object form and array form produce equivalent registries", () => {
    const Node = defineNode({ type: "a", schema: z.object({ text: z.string() }), component: Comp });
    const fromArr = createRegistry([Node]);
    const fromObj = createRegistry({ a: { component: Comp, propsSchema: Node.schema } });
    expect(fromArr.types()).toEqual(fromObj.types());
    expect(fromArr.get("a")?.component).toBe(fromObj.get("a")?.component);
    expect(fromArr.get("a")?.propsSchema).toBe(fromObj.get("a")?.propsSchema);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @kibadist/agentui-react exec vitest run test/registry-define-node.test.ts
```

Expected: TypeError (`createRegistry` doesn't accept arrays).

- [ ] **Step 3: Read current `packages/react/src/registry.ts`**

```ts
import type { ComponentType } from "react";

interface ZodLike<T = any> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

export interface ComponentSpec<P = any> {
  component: ComponentType<P>;
  propsSchema?: ZodLike<P>;
  requires?: string[];
}

export interface Registry {
  get(type: string): ComponentSpec | undefined;
  has(type: string): boolean;
  types(): string[];
}

export function createRegistry(
  map: Record<string, ComponentSpec>,
): Registry {
  const internal = new Map(Object.entries(map));
  return {
    get: (type) => internal.get(type),
    has: (type) => internal.has(type),
    types: () => [...internal.keys()],
  };
}
```

- [ ] **Step 4: Replace contents of `packages/react/src/registry.ts`**

```ts
import type { ComponentType } from "react";
import type { NodeDefinition } from "./define-node.js";

/** Minimal Zod-compatible schema shape (avoids hard dep on zod) */
interface ZodLike<T = any> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

/** Describes how a typed UI node maps to a rendered React component. */
export interface ComponentSpec<P = any> {
  component: ComponentType<P>;
  /** Optional Zod schema for runtime prop validation */
  propsSchema?: ZodLike<P>;
  /** Capability requirements at the component level */
  requires?: string[];
}

/**
 * A whitelisted lookup of UI node types to their rendered component specs.
 * Build one with {@link createRegistry}.
 */
export interface Registry {
  get(type: string): ComponentSpec | undefined;
  has(type: string): boolean;
  types(): string[];
}

/**
 * Build a `Registry`. Accepts either:
 * - a plain object map keyed by node type (legacy)
 * - an array of `NodeDefinition`s from `defineNode()` (schema-first)
 *
 * Both forms produce identical `Registry` behavior.
 */
export function createRegistry(map: Record<string, ComponentSpec>): Registry;
export function createRegistry(nodes: NodeDefinition<any>[]): Registry;
export function createRegistry(
  input: Record<string, ComponentSpec> | NodeDefinition<any>[],
): Registry {
  const internal = new Map<string, ComponentSpec>();

  if (Array.isArray(input)) {
    for (const node of input) {
      if (internal.has(node.type)) {
        throw new Error(`createRegistry: duplicate node type "${node.type}"`);
      }
      internal.set(node.type, nodeDefinitionToSpec(node));
    }
  } else {
    for (const [type, spec] of Object.entries(input)) {
      internal.set(type, spec);
    }
  }

  return {
    get: (type) => internal.get(type),
    has: (type) => internal.has(type),
    types: () => [...internal.keys()],
  };
}

function nodeDefinitionToSpec(node: NodeDefinition<any>): ComponentSpec {
  const spec: ComponentSpec = {
    component: node.component,
    propsSchema: node.schema as unknown as ZodLike,
  };
  if (node.requires !== undefined) {
    spec.requires = [...node.requires];
  }
  return spec;
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
pnpm --filter @kibadist/agentui-react exec vitest run test/registry-define-node.test.ts
```

Expected: 5 tests pass. Existing registry tests still pass.

- [ ] **Step 6: Run the FULL react suite**

```bash
pnpm --filter @kibadist/agentui-react exec vitest run
```

Expected: all tests green (back-compat preserved).

- [ ] **Step 7: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/registry.ts packages/react/test/registry-define-node.test.ts
git commit -m "feat(react): createRegistry array overload for NodeDefinition[]"
```

---

## Task 4: Type-level tests via .test-d.ts

**Files:**
- Create: `packages/react/test/define-node.test-d.ts`

- [ ] **Step 1: Write type-level tests in `packages/react/test/define-node.test-d.ts`**

```ts
import { expectTypeOf, test } from "vitest";
import { z } from "zod";
import type { ComponentType } from "react";
import { defineNode } from "../src/define-node.js";

const Comp: ComponentType<{ text: string; count: number }> = () => null;

test("schema drives component props inference", () => {
  const schema = z.object({ text: z.string(), count: z.number() });
  const node = defineNode({ type: "x", schema, component: Comp });
  expectTypeOf(node.schema).toEqualTypeOf<typeof schema>();
  expectTypeOf<Parameters<typeof node.build>[0]["props"]>().toEqualTypeOf<{
    text: string;
    count: number;
  }>();
});

test("build rejects mismatched props", () => {
  const schema = z.object({ text: z.string() });
  const node = defineNode({
    type: "x",
    schema,
    component: () => null as unknown as ReturnType<ComponentType<{ text: string }>>,
  });
  // @ts-expect-error — props.text must be string, not number
  node.build({ key: "k1", props: { text: 5 } });
  // @ts-expect-error — props.text is required
  node.build({ key: "k1", props: {} });
  // @ts-expect-error — unknown prop "extra"
  node.build({ key: "k1", props: { text: "ok", extra: 1 } });
});

test("build forbids meta.requires (forced via defineNode)", () => {
  const node = defineNode({
    type: "x",
    schema: z.object({ text: z.string() }),
    component: () => null as unknown as ReturnType<ComponentType<{ text: string }>>,
    requires: ["x.read"],
  });
  // @ts-expect-error — meta.requires is auto-derived from defineNode; can't be passed here
  node.build({ key: "k1", props: { text: "ok" }, meta: { requires: ["other"] } });
  // ttlMs is allowed
  node.build({ key: "k1", props: { text: "ok" }, meta: { ttlMs: 100 } });
});

test("component prop type must match schema", () => {
  // @ts-expect-error — component expects { wrong: boolean } but schema is { text: string }
  defineNode({
    type: "x",
    schema: z.object({ text: z.string() }),
    component: (() => null) as ComponentType<{ wrong: boolean }>,
  });
});
```

- [ ] **Step 2: Run typecheck via vitest**

```bash
pnpm test
```

Expected: typecheck pass — every `@ts-expect-error` actually fires, no other errors. Vitest reports the `.test-d.ts` runs in its summary.

- [ ] **Step 3: Sanity check — break a `@ts-expect-error` to confirm the harness works**

Temporarily replace one of the lines with a valid call (e.g., remove the `@ts-expect-error` above the line `node.build({ key: "k1", props: { text: 5 } })` and fix the `5` to `"5"`). Run `pnpm test` again — expect typecheck FAIL because the `@ts-expect-error` is now unused. Then revert.

- [ ] **Step 4: Verify full pnpm test still green after revert**

```bash
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add packages/react/test/define-node.test-d.ts
git commit -m "test(react): type-level assertions for defineNode and build()"
```

---

## Task 5: Re-export from react index barrel

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Read current index**

Confirm the current shape — should already export `createRegistry`, `ComponentSpec`, `Registry`.

- [ ] **Step 2: Add defineNode + types to the barrel**

Find:

```ts
export { createRegistry } from "./registry.js";
export type { ComponentSpec, Registry } from "./registry.js";
```

Change to:

```ts
export { createRegistry } from "./registry.js";
export type { ComponentSpec, Registry } from "./registry.js";

export { defineNode } from "./define-node.js";
export type { NodeDefinition, DefineNodeOptions, BuildArgs } from "./define-node.js";
```

- [ ] **Step 3: Verify build/typecheck**

```bash
pnpm --filter @kibadist/agentui-react build
pnpm typecheck
```

- [ ] **Step 4: Verify the public surface from the example app's vantage point**

```bash
node -e "import('@kibadist/agentui-react').then(m => console.log(Object.keys(m).sort()))"
```

Expected output includes `defineNode` and `createRegistry`.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/index.ts
git commit -m "feat(react): export defineNode and NodeDefinition types from main barrel"
```

---

## Task 6: README + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Read CHANGELOG.md**

Find the most recent version block (should be `## 0.6.3` from DET-146).

- [ ] **Step 2: Prepend a `## 0.6.4` block above `## 0.6.3`**

```markdown
## 0.6.4

### Added
- `defineNode({ type, schema, component, requires })` in `@kibadist/agentui-react`: schemas become the source of truth. Component props are inferred from the Zod schema; `Node.build({ key, props })` validates at emit time and produces a `UINode` wire payload. Capability requirements set on `defineNode` flow into `UINode.meta.requires` automatically.
- `createRegistry([NodeA, NodeB])` array overload accepts `NodeDefinition[]`. The existing `createRegistry({ "type": spec })` object form continues to work unchanged.
- `zod` listed as an **optional peer dependency** of `@kibadist/agentui-react`. Required only when calling `defineNode` or supplying a Zod `propsSchema` to the legacy object form.

### Notes
- Type-level safety verified via vitest `expectTypeOf` and `@ts-expect-error` in `packages/react/test/define-node.test-d.ts`.
- Auto-migration codemod (`@kibadist/agentui-codemods`) deferred — both API forms are supported indefinitely.
```

- [ ] **Step 3: Read README.md**

Find the CLI generator section added in DET-146.

- [ ] **Step 4: Add a "Schema-first nodes" subsection immediately after the CLI generator section**

```markdown
### Schema-first nodes

Define a node's type, schema, component, and capability requirements in one call. The component's props are inferred from the Zod schema; emit-time validation is automatic.

\`\`\`ts
import { z } from "zod";
import { defineNode, createRegistry } from "@kibadist/agentui-react";

const QuoteCardNode = defineNode({
  type: "quote-card",
  schema: z.object({
    quoteId: z.string(),
    total: z.number(),
  }),
  component: QuoteCard,
  requires: ["quotes.read"],
});

export const registry = createRegistry([QuoteCardNode]);

// Server side:
emit({ op: "ui.append", node: QuoteCardNode.build({
  key: "q-1",
  props: { quoteId: "Q-1", total: 1200 },
})});
\`\`\`

The legacy object form `createRegistry({ "type": { component, propsSchema } })` continues to work.
```

When you write this to README.md use real triple-backticks; the `\`\`\`` notation here is just for legibility in this plan.

- [ ] **Step 5: Verify all checks still pass**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs(react): CHANGELOG 0.6.4 + README schema-first nodes section"
```

---

## Self-Review Notes

Coverage vs spec:
- §2.1 `defineNode` → Task 2
- §2.2 `createRegistry` array overload → Task 3
- §2.3 example usage → README (Task 6)
- §3.1 build() error format → Task 2 (covered in implementation, asserted in tests)
- §3.2 schema constraint to ZodObject → Task 2 (TypeScript generic) + Task 4 (type-level test)
- §3.3 meta.requires derivation → Task 2 (test cases for set, unset, merge)
- §4 back-compat → Task 3 (object-form test still passes; equivalent-registries test)
- §5 zod peer dep → Task 0
- §6 file layout → Tasks 2, 3, 5
- §7.1 unit tests → Task 2
- §7.2 registry tests → Task 3
- §7.3 type-level tests → Task 4 (vitest typecheck enabled in Task 1)
- §8.1 CHANGELOG → Task 6
- §8.2 README → Task 6
- §9 out of scope → no tasks (intentional)

Identifier consistency:
- `defineNode`, `NodeDefinition`, `DefineNodeOptions`, `BuildArgs`, `createRegistry`, `ComponentSpec`, `Registry` — all used consistently across tasks.
- `nodeDefinitionToSpec` is the private helper in registry.ts (Task 3 only).
- Error message format: `"defineNode(${type}).build: invalid props\n${issues}"` defined in Task 2, asserted in Task 2's test #7 via `/invalid props/i`.
