# Hygiene Implementation Plan (DET-138)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three v0.4.4 hygiene fixes in one pass: re-export protocol event types from `@kibadist/agentui-react`, add explicit `"use client"` directives to React modules, and JSDoc every public export.

**Architecture:** Each fix is mechanical and orthogonal. Task 1 adds the re-exports + a compile-time type test. Task 2 prepends `"use client";` to seven React-bearing modules. Task 3 adds JSDoc to public exports across nine files. Task 4 updates CHANGELOG/README.

**Tech Stack:** TypeScript strict, React 19. Vitest only verifies the typecheck pathway in this plan — the rest is reviewed via build + manual smoke.

**Spec:** [docs/superpowers/specs/2026-05-18-hygiene-design.md](../specs/2026-05-18-hygiene-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/react/src/index.ts` | Modify | Add 8 protocol event-type re-exports |
| `packages/react/src/renderer.tsx` | Modify | Prepend `"use client";`; add JSDoc on `AgentRenderer` + `AgentRendererProps` |
| `packages/react/src/runtime-provider.tsx` | Modify | Prepend `"use client";`; add JSDoc on `AgentRuntimeProvider` + `AgentRuntimeProviderProps` |
| `packages/react/src/action-context.tsx` | Modify | Prepend `"use client";`; add JSDoc on `ActionSender`, `AgentActionContext`, `AgentActionProvider` |
| `packages/react/src/agent-state-context.tsx` | Modify | Prepend `"use client";`; add JSDoc on `AgentStateProvider`, `AgentStateProviderProps` |
| `packages/react/src/selectors.ts` | Modify | Prepend `"use client";`; add JSDoc on three convenience hooks |
| `packages/react/src/use-agent-stream.ts` | Modify | Prepend `"use client";`; add JSDoc on `useAgentStream`, `StreamStatus`, `UseAgentStreamOptions` |
| `packages/react/src/testing/mock-agent-stream.ts` | Modify | Prepend `"use client";` (JSDoc already present from DET-137) |
| `packages/react/src/registry.ts` | Modify | Add JSDoc on `ComponentSpec`, `Registry`, `createRegistry` |
| `packages/react/src/reducer.ts` | Modify | Add JSDoc on `Toast`, `AgentState`, `createInitialAgentState`, `AgentAction`, `agentReducer` |
| `packages/react/src/store.ts` | Modify | Add JSDoc on `AgentStore` interface, `createAgentStore` |
| `packages/react/test/public-api.test.ts` | Create | Compile-time type test + exhaustive narrowing test |
| `CHANGELOG.md` | Modify | Append to existing 0.4.0 |
| `README.md` | Modify | One-line migration note about dropping the protocol direct dep |

---

## Conventions

- All commands run from `/Users/max/agentui`.
- Test runner: `pnpm test` (one-shot — never watch mode).
- Typecheck: `pnpm --filter @kibadist/agentui-react typecheck`.
- Build: `pnpm --filter @kibadist/agentui-react build`.
- ESM `.js` extensions on relative imports throughout.

---

## Task 1: Type re-exports + public-api test

**Files:**
- Modify: `packages/react/src/index.ts`
- Create: `packages/react/test/public-api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/react/test/public-api.test.ts` with this exact content:

```ts
import { describe, it, expect } from "vitest";
import type {
  UIEvent,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
  UINavigateEvent,
  UIResetEvent,
  UINode,
} from "../src/index.js";

// Compile-time assertion: every protocol event type must be re-exported.
// If any of these imports goes missing, the file fails to typecheck.
type _AssertTypesExist =
  | UIEvent
  | UIAppendEvent
  | UIReplaceEvent
  | UIRemoveEvent
  | UIToastEvent
  | UINavigateEvent
  | UIResetEvent
  | UINode;

// onEvent narrowing — exhaustive switch with `never` fallback. If a new op
// is added to UIEvent and forgotten here, this fails to compile.
function _exhaustiveNarrowing(event: UIEvent): string {
  switch (event.op) {
    case "ui.append":
      return event.node.key;
    case "ui.replace":
      return event.key;
    case "ui.remove":
      return event.key;
    case "ui.toast":
      return event.message;
    case "ui.navigate":
      return event.href;
    case "ui.reset":
      return event.id;
    default: {
      const _: never = event;
      return _;
    }
  }
}

describe("public API", () => {
  it("re-exports all wire-protocol event types (typecheck-only)", () => {
    // The real assertion is at compile time — the imports + narrowing above.
    // This runtime check just registers the case with vitest.
    expect(typeof _exhaustiveNarrowing).toBe("function");
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck`
Expected: typecheck fails because `UIEvent` and the other types aren't yet re-exported from `index.ts`.

- [ ] **Step 3: Edit `packages/react/src/index.ts`**

Find this block at the top of the file:

```ts
export { createRegistry } from "./registry.js";
export type { ComponentSpec, Registry } from "./registry.js";
```

Insert this block IMMEDIATELY AFTER the two lines above (before `export { agentReducer, ... }`):

```ts

/**
 * Wire protocol event types — re-exported from `@kibadist/agentui-protocol`
 * so consumers can type `onEvent` callbacks and dispatch values without
 * depending on the protocol package directly.
 *
 * @example
 * useAgentStream({
 *   url,
 *   sessionId,
 *   onEvent: (event: UIEvent) => {
 *     switch (event.op) {
 *       case "ui.append":   // event is UIAppendEvent
 *       case "ui.replace":  // event is UIReplaceEvent
 *       // ...
 *     }
 *   },
 * });
 */
export type {
  UIEvent,
  UINode,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
  UINavigateEvent,
  UIResetEvent,
} from "@kibadist/agentui-protocol";
```

- [ ] **Step 4: Typecheck + run the new test**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/public-api.test.ts`
Expected: typecheck clean; `1 passed` from vitest.

- [ ] **Step 5: Run the full suite — no regressions**

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass (50 tests across 10 files).

- [ ] **Step 6: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/index.ts packages/react/test/public-api.test.ts
git commit -m "feat(react): re-export wire-protocol event types from index"
```

---

## Task 2: `"use client";` directives

**Files:**
- Modify (prepend `"use client";\n\n` as the very first line of each):
  - `packages/react/src/renderer.tsx`
  - `packages/react/src/runtime-provider.tsx`
  - `packages/react/src/action-context.tsx`
  - `packages/react/src/agent-state-context.tsx`
  - `packages/react/src/selectors.ts`
  - `packages/react/src/use-agent-stream.ts`
  - `packages/react/src/testing/mock-agent-stream.ts`

Each file gets `"use client";` as the very first line, followed by a blank line, then the existing content unchanged.

- [ ] **Step 1: Edit `packages/react/src/renderer.tsx`**

Find this top line:

```tsx
import { Component, createElement, Fragment, type ReactNode } from "react";
```

Insert the directive and a blank line ABOVE it so the file now starts with:

```tsx
"use client";

import { Component, createElement, Fragment, type ReactNode } from "react";
```

- [ ] **Step 2: Edit `packages/react/src/runtime-provider.tsx`**

Find this top line:

```tsx
import { useCallback, type ReactNode } from "react";
```

Prepend the directive so the file starts with:

```tsx
"use client";

import { useCallback, type ReactNode } from "react";
```

- [ ] **Step 3: Edit `packages/react/src/action-context.tsx`**

Find this top line:

```tsx
import { createContext, useContext, useCallback, type ReactNode } from "react";
```

Prepend:

```tsx
"use client";

import { createContext, useContext, useCallback, type ReactNode } from "react";
```

- [ ] **Step 4: Edit `packages/react/src/agent-state-context.tsx`**

Find this top line:

```tsx
import { createContext, useContext, type ReactNode } from "react";
```

Prepend:

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";
```

- [ ] **Step 5: Edit `packages/react/src/selectors.ts`**

Find this top line:

```ts
import { useCallback, useRef, useSyncExternalStore } from "react";
```

Prepend:

```ts
"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
```

- [ ] **Step 6: Edit `packages/react/src/use-agent-stream.ts`**

Find this top line:

```ts
import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from "react";
```

Prepend:

```ts
"use client";

import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from "react";
```

- [ ] **Step 7: Edit `packages/react/src/testing/mock-agent-stream.ts`**

Find this top line:

```ts
import { useSyncExternalStore } from "react";
```

Prepend:

```ts
"use client";

import { useSyncExternalStore } from "react";
```

- [ ] **Step 8: Typecheck + run the full suite**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test`
Expected: typecheck clean; all 50 tests pass.

- [ ] **Step 9: Build and verify the directive survives compilation**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react build`
Expected: build succeeds.

Run: `head -3 /Users/max/agentui/packages/react/dist/renderer.js`
Expected: the very first line is `"use client";` (with or without trailing semicolon — both are valid).

If the first line is anything other than `"use client";`, STOP and report BLOCKED. Otherwise continue.

Also spot-check one more: `head -3 /Users/max/agentui/packages/react/dist/use-agent-stream.js` should also start with `"use client";`.

- [ ] **Step 10: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/renderer.tsx packages/react/src/runtime-provider.tsx packages/react/src/action-context.tsx packages/react/src/agent-state-context.tsx packages/react/src/selectors.ts packages/react/src/use-agent-stream.ts packages/react/src/testing/mock-agent-stream.ts
git commit -m "chore(react): add 'use client' directives to React modules"
```

---

## Task 3: JSDoc on public exports

**Files:**
- Modify: 9 source files. Each gets one or more JSDoc blocks prepended to existing exports.

The implementer should add the JSDoc text shown below IMMEDIATELY ABOVE the matching `export ...` line in each file. If an export already has a JSDoc block, leave it alone (do not duplicate or rewrite).

### Step 1: `packages/react/src/registry.ts`

Above `export interface ComponentSpec<P = any>`:

```ts
/** Describes how a typed UI node maps to a rendered React component. */
```

Above `export interface Registry`:

```ts
/**
 * A whitelisted lookup of UI node types to their rendered component specs.
 * Build one with {@link createRegistry}.
 */
```

Above `export function createRegistry`:

```ts
/**
 * Build a `Registry` from a plain object map. Component specs are looked up
 * by their UI-node type string at render time.
 */
```

### Step 2: `packages/react/src/reducer.ts`

Above `export interface Toast`:

```ts
/** A transient notification queued by `ui.toast` events. */
```

Above `export interface AgentState`:

```ts
/**
 * The reducer's state shape. `nodes` is the ordered list of rendered UI nodes;
 * `byKey` maps each node's key to its index for O(1) lookup; `toasts` is the
 * queue of un-dismissed notifications; `navigate` is the latest pending
 * navigation intent (or null).
 */
```

Above `export function createInitialAgentState`:

```ts
/**
 * Create a fresh empty `AgentState`. Returns a new `byKey` Map per call —
 * safe to call multiple times without aliasing.
 */
```

Above `export type AgentAction = UIEvent | AgentResetAction;`:

```ts
/**
 * Discriminated union over actions accepted by {@link agentReducer}: any
 * `UIEvent` plus the synthetic `__reset__` action.
 */
```

Above `export function agentReducer`:

```ts
/**
 * Pure reducer over `AgentState`. Returns the same state reference for no-op
 * actions (e.g., `ui.replace` for an unknown key), which lets stores
 * short-circuit listener notifications.
 */
```

(`initialAgentState` and `AgentResetAction` already have JSDoc — leave them alone.)

### Step 3: `packages/react/src/store.ts`

Above `export interface AgentStore`:

```ts
/**
 * A subscribable wrapper around `AgentState` driven by `agentReducer`.
 * Wire into `<AgentStateProvider>` to power selector hooks
 * (`useAgentNodes`, `useAgentSelector`, etc.).
 */
```

Above `export function createAgentStore`:

```ts
/** Build an `AgentStore`. Optionally seed with initial state. */
```

(Field-level JSDoc on `getState`/`subscribe`/`send`/`reset` already exists — leave it.)

### Step 4: `packages/react/src/agent-state-context.tsx`

Above `export interface AgentStateProviderProps`:

```ts
/** Props for {@link AgentStateProvider}. */
```

Above `export function AgentStateProvider`:

```ts
/**
 * Puts an `AgentStore` on context so selector hooks (`useAgentNodes`,
 * `useAgentSelector`, etc.) can subscribe to it. Typically wired from
 * `useAgentStream(...).store`.
 */
```

(`useAgentStore` already has JSDoc — leave it.)

### Step 5: `packages/react/src/selectors.ts`

Above `export const useAgentNodes = ...`:

```ts
/** Subscribe to `state.nodes`. Re-renders only when the nodes array reference changes. */
```

Above `export const useAgentToasts = ...`:

```ts
/** Subscribe to `state.toasts`. Re-renders only when the toasts array reference changes. */
```

Above `export const useAgentNavigate = ...`:

```ts
/** Subscribe to the latest pending navigation intent (or null). Re-renders only when that slice changes. */
```

(`useAgentSelector` already has JSDoc — leave it.)

### Step 6: `packages/react/src/renderer.tsx`

Above `export interface AgentRendererProps`:

```tsx
/**
 * Props for {@link AgentRenderer}. Composition order is
 * `slot → range → filter → hiddenTypes`. All optional props default to no-op.
 */
```

Above `export function AgentRenderer`:

```tsx
/**
 * Render the current `AgentState.nodes` through a whitelisted `Registry`.
 * See {@link AgentRendererProps} for slicing, filtering, error containment,
 * and per-node wrapping hooks.
 */
```

### Step 7: `packages/react/src/action-context.tsx`

Above `export type ActionSender`:

```tsx
/** Function the action context dispatches user actions through (typically a POST to the backend). */
```

Above `export const AgentActionContext`:

```tsx
/**
 * React context holding the current {@link ActionSender}. Most consumers
 * should use {@link useAgentAction} rather than reading this directly.
 */
```

Above `export function AgentActionProvider`:

```tsx
/**
 * Puts an {@link ActionSender} on context so descendants can call
 * {@link useAgentAction} to dispatch user actions back to the agent.
 */
```

The existing JSDoc on `useAgentAction` is:

```tsx
/**
 * Hook to dispatch an action back to the agent.
 * Components should use this instead of calling fetch directly.
 */
```

Leave it as-is — it's already documented.

### Step 8: `packages/react/src/use-agent-stream.ts`

Above `export type StreamStatus`:

```ts
/**
 * The lifecycle state of the underlying `EventSource`: `idle` before the
 * effect runs, `connecting` during the handshake, `open` after, `closed`
 * when stopped, `error` on transport failure.
 */
```

Above `export interface UseAgentStreamOptions`:

```ts
/** Options for {@link useAgentStream}. */
```

(The existing `UseAgentStreamResult` already has field-level JSDoc — add a one-line summary above the interface declaration:)

Above `export interface UseAgentStreamResult`:

```ts
/** What {@link useAgentStream} returns: state, status, and control methods. */
```

Above `export function useAgentStream`:

```ts
/**
 * Subscribe to an SSE-backed agent stream. Returns the reducer state, the
 * connection status, and methods to close, reset, or dispatch — plus the
 * underlying `store` for wiring `<AgentStateProvider>`.
 */
```

### Step 9: `packages/react/src/runtime-provider.tsx`

Above `export interface AgentRuntimeProviderProps`:

```tsx
/** Props for {@link AgentRuntimeProvider}. */
```

Above `export function AgentRuntimeProvider`:

```tsx
/**
 * Render-prop convenience wrapper: starts an SSE stream via
 * {@link useAgentStream}, sets up an action POST endpoint, and exposes
 * `{ state, status, close }` to children. For quick wiring; the v0.5
 * `<AgentRoot>` lifecycle provider will subsume this surface.
 */
```

### Step 10: Typecheck + run the full suite

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test`
Expected: typecheck clean; all 50 tests pass. (JSDoc additions don't affect runtime; the test pass count is unchanged from Task 2.)

### Step 11: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/registry.ts packages/react/src/reducer.ts packages/react/src/store.ts packages/react/src/agent-state-context.tsx packages/react/src/selectors.ts packages/react/src/renderer.tsx packages/react/src/action-context.tsx packages/react/src/use-agent-stream.ts packages/react/src/runtime-provider.tsx
git commit -m "docs(react): JSDoc every public export"
```

---

## Task 4: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md` (append to existing 0.4.0)
- Modify: `README.md` (one-line migration note)

- [ ] **Step 1: Edit `CHANGELOG.md`**

Find the last bullet currently in the `0.4.0` → `### Added — @kibadist/agentui-react` list. It is:

```md
- **Testing subpath** (`@kibadist/agentui-react/testing`). Ships `createMockAgentStream(initial?)` (hook + control surface: `push`, `dispatchInternal`, `setStatus`, `reset`, `state` getter, `history`), pure `pushEvent` / `replayConversation` reducer helpers, and `createTestRegistry` (a Registry that stubs missing types with marker components for assertions). No runtime cost — vitest stays a devDep.
```

After it, insert these three new bullets (still inside the `### Added — @kibadist/agentui-react` list, before the blank line that precedes `### Behavior`):

```md
- **Wire protocol event types** are now re-exported from `@kibadist/agentui-react`: `UIEvent`, `UINode`, `UIAppendEvent`, `UIReplaceEvent`, `UIRemoveEvent`, `UIToastEvent`, `UINavigateEvent`, `UIResetEvent`. Consumers that depended on `@kibadist/agentui-protocol` only to type `onEvent` callbacks can drop that direct dependency:

  ```diff
  - import type { UIEvent } from "@kibadist/agentui-protocol";
  + import type { UIEvent } from "@kibadist/agentui-react";
  ```
- **`"use client"` directives** added to every module that uses React hooks or contexts (renderer, runtime-provider, action-context, agent-state-context, selectors, use-agent-stream, testing/mock-agent-stream). Removes the need for consumer-side shim files in Next.js App Router projects.
- **JSDoc on every public export** — interfaces, types, factory functions, hooks, components. Renderer prop semantics, hook return shapes, and event-op narrowing each get inline docs.
```

- [ ] **Step 2: Edit `README.md`**

In the existing "Testing helpers" subsection (added by DET-137), or just before the next `---` separator after it, locate the most recent informational line in the section. The simplest addition: extend the closing line of the Testing helpers subsection. Find this line in README.md:

```md
Also exposes `pushEvent(state, event)` and `replayConversation(events)` for pure reducer-level tests, and `createTestRegistry(map)` (a Registry that renders `<span data-testid="test-marker-{type}">` for unregistered types).
```

After this line, BEFORE the next `---` separator, insert a new H3 subsection:

```md

### Dropping the protocol direct dep

Wire-event types (`UIEvent`, `UIAppendEvent`, etc.) are re-exported from `@kibadist/agentui-react` as of 0.4.0. Consumers that previously dual-depended on `@kibadist/agentui-protocol` just to type `onEvent` can drop it:

```diff
- import type { UIEvent } from "@kibadist/agentui-protocol";
+ import type { UIEvent } from "@kibadist/agentui-react";
```
```

- [ ] **Step 3: Run the full suite as a smoke check**

Run: `cd /Users/max/agentui && pnpm test`
Expected: all 50 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/max/agentui
git add CHANGELOG.md README.md
git commit -m "docs: document type re-exports + 'use client' + JSDoc (0.4.0)"
```

---

## Verification — done when

- [ ] `pnpm test` passes — 50 tests across 10 files (the new `public-api.test.ts` adds 1 test).
- [ ] `pnpm --filter @kibadist/agentui-react typecheck` clean.
- [ ] `pnpm --filter @kibadist/agentui-react build` clean, and `head -3 dist/renderer.js` shows `"use client";` as the first line.
- [ ] `git log --oneline` shows the four task commits in order.
- [ ] No version bumps in `package.json` files. Release script handles versioning.
- [ ] DET-138 transitioned to "Done" in Linear after the last commit lands.

## Out of scope (restated from spec)

- API-extractor toolchain.
- Re-exporting `ActionEvent` (UI → agent direction).
- Build-time directive injection.
- Rewriting existing JSDoc style.
