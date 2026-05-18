# Hygiene: re-exports, `'use client'`, JSDoc (DET-138 / v0.4.4)

Linear: [DET-138 — v0.4 — Hygiene: type re-exports, JSDoc, `'use client'` directives](https://linear.app/detailing-app/issue/DET-138)

## Goal

Three small DX fixes shipped together: re-export protocol event types from `@kibadist/agentui-react`, add explicit `'use client'` directives to React modules, and JSDoc every public export. Net result: consumers can drop their direct dep on `@kibadist/agentui-protocol`, get correct RSC boundary inference in Next.js without import shims, and see inline docs for every public symbol.

## Non-goals

- `@microsoft/api-extractor` toolchain. Deferred to a pre-1.0 ticket. The compile-time type test in this plan is sufficient for v0.4.4.
- Re-exporting `ActionEvent` (UI → agent direction). The ticket lists wire-event types only; `ActionEvent` is consumed via `useAgentAction`'s signature.
- Build-time directive injection. Manual annotation is simpler for 7 files.
- Rewriting existing JSDoc style. Only ADD missing JSDoc; don't touch comments that already exist unless they're outright wrong.

## 1) Type re-exports

Add to `packages/react/src/index.ts`, immediately after the existing `createRegistry` exports (top of file, before reducer/store/etc.):

```ts
/**
 * Wire protocol event types — re-exported from `@kibadist/agentui-protocol`
 * so consumers can type `onEvent` callbacks and dispatch values without
 * depending on the protocol package directly.
 *
 * @example
 * useAgentStream({
 *   url, sessionId,
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

### Migration

Consumers may now drop `@kibadist/agentui-protocol` from their `dependencies` when they only used it for types. Documented in CHANGELOG with a before/after snippet.

## 2) `'use client'` directives

The first line(s) of each affected file becomes:

```ts
"use client";

import { ... } from "react";
// ... rest of file unchanged
```

TypeScript preserves top-of-file string-literal directives through compilation; the directive lands in the emitted `dist/*.js` files where bundlers read it.

### Files annotated (7)

| File | React surface that triggers RSC client classification |
|---|---|
| `packages/react/src/renderer.tsx` | JSX + internal class component `NodeErrorBoundary` |
| `packages/react/src/runtime-provider.tsx` | `useCallback`, render-prop |
| `packages/react/src/action-context.tsx` | `createContext`, `useContext`, `useCallback` |
| `packages/react/src/agent-state-context.tsx` | `createContext`, `useContext` |
| `packages/react/src/selectors.ts` | `useSyncExternalStore`, `useCallback`, `useRef` |
| `packages/react/src/use-agent-stream.ts` | `useEffect`, `useRef`, `useState`, `useSyncExternalStore` |
| `packages/react/src/testing/mock-agent-stream.ts` | `useSyncExternalStore` |

### Files NOT annotated

| File | Why |
|---|---|
| `packages/react/src/reducer.ts` | Pure functions |
| `packages/react/src/registry.ts` | Pure factory |
| `packages/react/src/store.ts` | Pure closure |
| `packages/react/src/testing/replay.ts` | Pure reducer wrappers |
| `packages/react/src/testing/test-registry.tsx` | Factory function; the marker component is constructed lazily and only consumed by `AgentRenderer` at runtime — the module itself doesn't run JSX at evaluation time and is imported only from vitest setups |
| `packages/react/src/testing/index.ts` | Re-exports only |
| `packages/react/src/index.ts` | Re-exports only |

Rationale: adding `'use client'` to a pure module is a benign waste (forces it into the client bundle even when imported only by server code). Skipping it where it's not needed keeps server-renderable parts server-renderable.

### Build verification

After all directives are in place, manually check that `dist/renderer.js` starts with `"use client";` — TypeScript's behavior is well-documented but worth a one-shot smoke test. This is captured as a step in the implementation plan, not as a runtime test.

## 3) JSDoc on public exports

Style:
- One-sentence summary on the line(s) immediately preceding each export.
- For interfaces/types: describe the role; don't enumerate every field (field-level docs go on the fields themselves).
- For functions/hooks: describe behavior + return shape in one sentence. Add `@example` only where the call site is non-obvious.
- No multi-paragraph docstrings. No `@param` / `@returns` blocks unless the signature is genuinely confusing.

### Audit — public exports needing JSDoc

`registry.ts`:
- `ComponentSpec` — interface summary
- `Registry` — interface summary
- `createRegistry` — function summary

`reducer.ts`:
- `agentReducer` — function summary (mention "pure reducer")
- `createInitialAgentState` — function summary
- `AgentState` — interface summary
- `AgentAction` — type alias summary (mention "UIEvent | AgentResetAction")
- `AgentResetAction` — interface summary (already has JSDoc; verify)
- `Toast` — interface summary
- `initialAgentState` — already has `@deprecated` JSDoc; leave alone

`store.ts`:
- `AgentStore` — already has field-level JSDoc; add interface-level summary
- `createAgentStore` — function summary

`agent-state-context.tsx`:
- `AgentStateProvider` — component summary
- `AgentStateProviderProps` — interface summary

`selectors.ts`:
- `useAgentSelector` — already has JSDoc; verify
- `useAgentNodes` — one-line
- `useAgentToasts` — one-line
- `useAgentNavigate` — one-line

`renderer.tsx`:
- `AgentRenderer` — component summary with `@example`
- `AgentRendererProps` — interface summary (composition order line); fields already documented

`action-context.tsx`:
- `ActionSender` — type alias summary
- `AgentActionContext` — `React.Context` re-export; one-line
- `AgentActionProvider` — component summary
- `useAgentAction` — hook summary, mention error semantics if any

`use-agent-stream.ts`:
- `useAgentStream` — function summary with `@example`
- `StreamStatus` — type alias summary (enumerate values)
- `UseAgentStreamOptions` — interface summary
- `UseAgentStreamResult` — interface summary (fields already documented)

`runtime-provider.tsx`:
- `AgentRuntimeProvider` — component summary; mention render-prop
- `AgentRuntimeProviderProps` — interface summary

## Test plan

New file: `packages/react/test/public-api.test.ts`. Single test that compiles-or-fails:

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

The single runtime assertion exists only so vitest registers the file. The actual coverage is the imports (re-exports must exist) + the exhaustive narrowing (the discriminated union must work as documented).

### What the test does NOT do

- Snapshot the full `dist/index.d.ts`. That's API-extractor territory and is deferred.
- Test JSDoc presence. JSDoc is enforced by code review, not automation.
- Test that `'use client'` directives compile through. The implementation plan has a manual smoke step (`head -3 dist/renderer.js`).

## File touches

| File | Action |
|---|---|
| `packages/react/src/index.ts` | Add 8 type re-exports + JSDoc block on the re-export group |
| `packages/react/src/renderer.tsx` | Prepend `"use client";`; add JSDoc on `AgentRenderer` and `AgentRendererProps` |
| `packages/react/src/runtime-provider.tsx` | Prepend `"use client";`; add JSDoc |
| `packages/react/src/action-context.tsx` | Prepend `"use client";`; add JSDoc on all 4 exports |
| `packages/react/src/agent-state-context.tsx` | Prepend `"use client";`; add JSDoc on `AgentStateProvider` + props |
| `packages/react/src/selectors.ts` | Prepend `"use client";`; add JSDoc on 3 convenience hooks |
| `packages/react/src/use-agent-stream.ts` | Prepend `"use client";`; add JSDoc on `useAgentStream`, `StreamStatus`, `UseAgentStreamOptions` |
| `packages/react/src/testing/mock-agent-stream.ts` | Prepend `"use client";` (JSDoc already in place from DET-137) |
| `packages/react/src/registry.ts` | Add JSDoc only |
| `packages/react/src/reducer.ts` | Add JSDoc only |
| `packages/react/src/store.ts` | Add interface-level JSDoc + JSDoc on `createAgentStore` |
| `packages/react/test/public-api.test.ts` | Create — compile-time type test |
| `CHANGELOG.md` | Append to 0.4.0 |
| `README.md` | One-line dep-drop migration note (optional; could also live only in CHANGELOG) |

## Edge cases

- **`tsconfig.json` `removeComments`.** Verify it's NOT set (or set to `false`); JSDoc would be stripped otherwise. The current `tsconfig.base.json` doesn't set it, so JSDoc survives by default.
- **`"use client";` and top-of-file `import type` statements.** Type-only imports can appear after a string directive — TypeScript handles them like regular imports for directive purposes. No special ordering concern.
- **Mock-agent-stream.ts is in `testing/` subpath.** Adding `'use client'` is fine — vitest doesn't care, and if a host accidentally imports it from a server component the directive does the right thing.
- **Re-exports type ordering.** The 8 types are re-exported as a single `export type { ... } from "..."` block to keep the index.ts diff minimal and the JSDoc block coherent.

## Migration

Additive everywhere. Two consumer-facing changes:

```diff
- import type { UIEvent } from "@kibadist/agentui-protocol";
+ import type { UIEvent } from "@kibadist/agentui-react";

  // package.json
- "dependencies": {
-   "@kibadist/agentui-react": "^0.4.0",
-   "@kibadist/agentui-protocol": "^0.4.0"
- }
+ "dependencies": {
+   "@kibadist/agentui-react": "^0.4.0"
+ }
```

(Consumers who still want the direct dep — e.g., to import `ActionEvent` — are unaffected.)

## Open questions

None blocking. Two decided inline:

- **Should we add `@deprecated` to `agentReducer` / `initialAgentState` / `createInitialAgentState` to nudge consumers toward `createAgentStore`?** No. They're still useful for reducer-level tests (and the `/testing` subpath exposes `pushEvent` / `replayConversation` which wrap them). Deprecation would create churn for no DX win.
- **Should `AgentActionContext` be removed from the public surface?** It's exported but not currently mentioned in the README. Out of scope here; if removal is wanted, file a separate ticket.
