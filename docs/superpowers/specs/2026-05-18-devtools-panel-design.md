# DET-145 — DevTools Panel Design Spec

**Target release:** v0.6.2 (after v0.6.1 — LLM adapters).
**Package:** `@kibadist/agentui-react` (new subpath `/devtools`).
**Migration:** Additive. Zero impact on existing consumers.

---

## 1. Motivation

Today, debugging an AgentUI conversation means hand-rolling `console.log` on every wire event. This costs us:

- **Adoption.** A polished DevTools panel is a screenshot-friendly artifact ("look how nice debugging is in AgentUI") and a high-leverage marketing surface for a library whose distinguishing feature is *typed, observable* agent UI.
- **Velocity.** Engineers building on AgentUI lose minutes per bug to stringifying state by hand.
- **Confidence.** Without an event log, race conditions and state-machine bugs (`tool.args-delta` for a missing `tool.start`, `reasoning.delta` after `reasoning.end`, etc.) are nearly invisible.

We will ship a floating, opt-in panel that shows the wire-event log, the current `AgentState`, and a time-travel scrubber.

---

## 2. Surface area

### 2.1 Public components and hooks

- `<AgentDevTools />` — floating panel React component.
- `useAgentDevToolsRecorder()` — hook returning the live recording, exposed for advanced consumers and used internally by the panel.
- Re-exported helper: `replayConversation(events)` (already exists in `@kibadist/agentui-react/testing`; we expose it from `/devtools` too because the panel's time-travel guarantee is defined in terms of it).

### 2.2 Subpath export

The panel and recorder ship under `@kibadist/agentui-react/devtools`. The main `@kibadist/agentui-react` barrel does **not** re-export them — that guarantees that an app which never imports `/devtools` has no DevTools code in its production bundle (zero bytes; bundler tree-shake works because the subpath is never traversed).

`packages/react/package.json` gains a new entry in `exports`:

```json
"./devtools": {
  "types": "./dist/devtools/index.d.ts",
  "import": "./dist/devtools/index.js",
  "default": "./dist/devtools/index.js"
}
```

The panel must be tagged `"use client"` and consumed only from client components (it owns local state, event listeners, and the DOM).

### 2.3 `<AgentDevTools />` props

```ts
interface AgentDevToolsProps {
  /**
   * Force the panel on or off. If omitted, the panel is enabled when
   * `process.env.NODE_ENV !== "production"` OR `process.env.NEXT_PUBLIC_AGENTUI_DEVTOOLS === "1"`.
   * When the result resolves to false, the component renders `null` and
   * (importantly) the recorder is never installed — zero runtime cost.
   */
  enabled?: boolean;

  /** Corner anchor. Default: "br". */
  position?: "br" | "bl" | "tr" | "tl";

  /** Max events to retain (ring buffer). Default: 500. */
  maxEvents?: number;

  /** Scope the panel to a specific <AgentRoot id="…">. Omit to use the nearest. */
  id?: string;
}
```

The panel **must** be mounted inside `<AgentRoot>` (because it reads the store from context). Mounting it outside throws with a clear `[agentui]` message.

---

## 3. Recording model

### 3.1 What we record

For every action that flows through the store after the panel mounts, the recorder captures:

```ts
interface RecordedEvent {
  /** Monotonic seq, starting at 0 from panel mount. */
  seq: number;
  /** The raw action (wire event or synthetic __reset__). */
  action: AgentAction;
  /** Wall-clock timestamp of capture (panel's clock, not event.ts). */
  capturedAt: number;
  /** State *after* applying this action. Reference-shared with the live store when this is the last event. */
  state: AgentState;
  /** Milliseconds from store.send() call to listener-notify completion. */
  dispatchMs: number;
}
```

Snapshots are pre-computed at every event. Time-travel is therefore O(1) (array index) — *not* a re-fold. The cost is memory: with structural sharing in the reducer (Maps are recreated per action, but nodes/toolCalls/reasoning entries are reused when unchanged), the snapshot list is approximately `O(maxEvents × avg-state-diff)`, which is bounded.

When the ring buffer is full, the oldest event is evicted. The seq number is *not* reset — so a user scrubbing position never sees stale seq references.

### 3.2 Hooking the store

To record actions (not just state changes), we need the action itself. The current `AgentStore` only exposes state-change notifications via `subscribe`. We extend `AgentStore` with a new method:

```ts
interface AgentStore {
  // existing:
  getState(): AgentState;
  subscribe(listener: () => void): () => void;
  send(action: AgentAction): void;
  reset(): void;

  // new (additive):
  subscribeAction(listener: (action: AgentAction, nextState: AgentState, dispatchMs: number) => void): () => void;
}
```

Inside `createAgentStore`:

- A second `Set<actionListener>` is maintained.
- After `agentReducer` runs, if `next !== state` (state changed), all action listeners are notified. (We deliberately skip no-op actions — they have no effect, no debug value, and they would inflate the ring buffer.)
- `dispatchMs` is measured around the listener-notify loop. Both regular subscribers and action subscribers are awaited within the same window.

This API is also generally useful (e.g., a host could log every dispatched event to Sentry), so we expose it publicly from the main barrel.

### 3.3 Recorder lifecycle

The `useAgentDevToolsRecorder()` hook:

1. On mount, captures the current state as `seq=0` with a synthetic `__init__` action sentinel (or skips it — see decision below).
2. Subscribes via `store.subscribeAction`.
3. Pushes each captured event into a `useRef<RecordedEvent[]>` array (mutable, no rerender per event).
4. Bumps a `version: number` `useSyncExternalStore` snapshot to trigger a panel rerender at most every animation frame (we'll throttle with `requestAnimationFrame` to avoid melting under high-throughput streams).
5. On unmount, removes the subscription. The recorded buffer is dropped.

**Decision:** Do not synthesize a `__init__` event. The initial state is implicit (`createInitialAgentState()`), and inventing a synthetic op pollutes the event log. The state tree at scrubPos `-1` is just `createInitialAgentState()`.

### 3.4 No replay-causality contract

The panel does *not* attempt to recreate the host app's render output at a past point in time. Scrubbing the slider only changes what the panel itself displays — the host `<AgentRenderer>` and selector hooks continue to read live state.

This is intentional. "Rewind the entire UI" would require swapping the store's state out and back, which would (a) confuse host code reading via selectors, (b) re-run effects in weird orders, and (c) is far out of scope for v0.6.2.

The ticket's test ("scrubbing to event N produces the state that `replayConversation(events.slice(0, N+1))` would produce") is about *what the panel renders for the state tree*, not about rewinding the app.

---

## 4. UI layout

```
┌─ [AgentDevTools] ───────────────────────────── [↕ collapse] [×] ─┐
│ ┌─ Event Log (scrollable, virtualized) ─┐ ┌─ State Tree ─────┐  │
│ │ #42 ui.replace   key=msg-3   +12 keys │ │ ▾ nodes (3)      │  │
│ │ #41 ui.append    key=msg-3   …        │ │   [0] text-block │  │
│ │ #40 tool.result  id=t-1      ok 230ms │ │   [1] text-block │  │
│ │ …                                     │ │ ▾ toolCalls (1)  │  │
│ │                                       │ │   t-1  search    │  │
│ │ filter: [✓ui ✓tool ✓reasoning ✓opt]   │ │ ▸ reasoning (0)  │  │
│ │ search: [_______________]             │ │ ▸ byKey index    │  │
│ └───────────────────────────────────────┘ └──────────────────┘  │
│ ◀──────●────────────────────────────────────▶ event 42 / 178   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 Components

- **Event Log** (left panel) — virtualized scrolling list of records. Each row: `#seq` · `op` · short summary (key/id for ui events, name for tools, etc.) · timestamp. Click a row to seek the scrubber to that event.
- **State Tree** (right panel) — collapsible tree of the current view-state. Renders nodes, toasts, navigate, toolCalls (with byKey), reasoning, optimistic, byKey index — each as a top-level collapsible. Uses a plain `<details>`/`<summary>` tree (no third-party tree-view dep).
- **Filter bar** — checkboxes for each category (ui / tool / reasoning / optimistic / session). State held inline; affects what the event log renders, *not* what's recorded.
- **Scrubber** — `<input type="range" min="0" max={events.length} value={scrubPos}>`. `value === events.length` means "live". Any value below pauses the State Tree view at that snapshot.
- **Header chrome** — drag handle, collapse/expand toggle, close (×) button. Drag uses pointer events; persists position to `localStorage` under `agentui:devtools:pos`.
- **Dispatch latency** — small inline indicator in the header: `mean / p99` over the last 100 events. Tooltip shows histogram bins. (Cheap: just iterate the recent slice on each panel render.)

### 4.2 Styling and packaging

- All styles inline (CSS-in-JS via `style` attribute), scoped to the panel root. No global CSS, no Tailwind dependency. This is consistent with the rest of the library (zero-CSS surface).
- Panel uses `position: fixed`, z-index `2147483000` (≈ max), so it floats above all app content.
- No icon library. Use unicode glyphs (`◀ ▶ ▾ ▸ ×`).

### 4.3 What we are not building (YAGNI)

- Network inspector (we don't manage HTTP requests; SSE is opaque from inside).
- Action-from-panel re-dispatch ("send this event again").
- Diff view between snapshot N and N+1.
- Export-to-file. (Easy follow-up, but not required.)
- Profiling flame charts.
- Component tree alongside state tree.
- Search across state tree.
- Persistent recording across reloads.
- Multi-agent tab switcher inside the panel. (For multi-agent apps, mount one `<AgentDevTools id="…">` per agent.)

---

## 5. Production gating

`<AgentDevTools enabled={false}>` short-circuits before mounting the recorder. No subscription, no buffer, no event listeners. Render returns `null`.

The default-enabled check:

```ts
const isDevToolsEnabled =
  enabled ??
  (process.env.NODE_ENV !== "production" ||
   process.env.NEXT_PUBLIC_AGENTUI_DEVTOOLS === "1");
```

Both `process.env.NODE_ENV` and `NEXT_PUBLIC_AGENTUI_DEVTOOLS` are dead-code-eliminated by modern bundlers (Webpack, Vite, esbuild) when statically replaced. If a consumer mounts `<AgentDevTools />` in a production build with no env override, the entire component body shakes out — but the *import* of `@kibadist/agentui-react/devtools` still loads code into the bundle. Hence the recommendation in docs: `const AgentDevTools = process.env.NODE_ENV === "production" ? null : require("@kibadist/agentui-react/devtools").AgentDevTools;` for hosts who need strict zero-bytes-in-prod. (Most hosts will accept the few kB.)

---

## 6. `replayConversation` widening

`replayConversation` currently accepts `UIEvent[]`. Tool/reasoning/optimistic/session-meta events go through the same reducer but the helper's input type is too narrow. We will widen it to accept the full `AgentAction` union (minus `__reset__`):

```ts
export type ReplayableEvent = Exclude<AgentAction, AgentResetAction>;
export function replayConversation(events: ReplayableEvent[]): AgentState;
```

This is a runtime no-op (the reducer already handles all of them) but unblocks the panel's "fold events 0..N to get state at N" type check. Back-compat: passing `UIEvent[]` still works (assignable to the wider type).

---

## 7. File layout

```
packages/react/src/
  devtools/
    index.ts           # re-exports
    agent-devtools.tsx # <AgentDevTools /> + collapsed/expanded chrome
    recorder.ts        # useAgentDevToolsRecorder() hook + types
    event-log.tsx      # virtualized log panel + filters/search
    state-tree.tsx     # collapsible state tree
    scrubber.tsx       # range input + position state
    summarize.ts       # one-line summary per action op (for log rows)
    layout.ts          # dragging, persistence, z-index helpers
```

`packages/react/src/store.ts` extends `AgentStore` with `subscribeAction`. `packages/react/src/index.ts` re-exports `subscribeAction` *only* indirectly (it's a method on the existing `AgentStore`, no new type-export needed; we export the method via its presence on the interface).

`packages/react/tsconfig.json` already covers everything under `src/` — no change needed.

`packages/react/package.json` gets the `./devtools` exports entry (see §2.2).

`packages/react/src/testing/replay.ts` widens the parameter type (see §6).

---

## 8. Test plan

All tests live in `packages/react/test/devtools/`.

### 8.1 Mounting and rendering

- `<AgentDevTools enabled>` mounts inside `<AgentRoot>` without errors, renders the panel chrome (`AgentDevTools` text, scrubber, log, tree).
- Mounting outside `<AgentRoot>` throws an `[agentui]` error.
- `<AgentDevTools enabled={false}>` renders `null` and does not subscribe to the store. (Verify by `vi.spyOn` on `store.subscribeAction`.)
- Default `enabled` follows the env-flag rules (test by setting `process.env.NEXT_PUBLIC_AGENTUI_DEVTOOLS = "1"` then unsetting).

### 8.2 Recorder correctness

- After 5 events flow through the store, the recorder's array has 5 entries with monotonically increasing `seq` (`0..4`).
- Each entry's `state` deep-equals `replayConversation(actions.slice(0, i+1))`.
- A `tool.args-delta` for an unknown tool id (a no-op) is NOT recorded (filtered by the "skip no-ops" rule).
- After `maxEvents` is exceeded, the oldest entries are evicted; `seq` continues monotonically.

### 8.3 Time-travel scrubbing

- Scrub to event N → the State Tree renders the state from `replayConversation(actions.slice(0, N+1))`. (Direct property check on the rendered DOM, e.g., assert node count, tool count.)
- Scrubbing does NOT affect what `useAgentNodes()` returns for other consumers — they continue reading live state. (Mount a sibling component that reads `useAgentNodes()`, assert its output is the live state.)
- Scrubber at `value === events.length` shows live state and follows new events (scrubPos is "stuck to live" until the user grabs it).

### 8.4 Filter and search

- Filter checkbox toggles affect which event log rows render. Verify rendered row count.
- Toggling a filter does NOT cause the State Tree to rerender. Use `useRef` count + render-count assertions (or `React.memo` boundary checks via `vi.fn`).
- Search box filters by substring match against the summary line.

### 8.5 Production gating

- With `process.env.NODE_ENV = "production"` and no `NEXT_PUBLIC_AGENTUI_DEVTOOLS`, `<AgentDevTools />` renders `null` and the recorder is not installed.
- With the env flag set to `"1"`, the panel mounts and records normally.

### 8.6 `subscribeAction` API

- Subscribing to `store.subscribeAction` is notified with `(action, nextState, dispatchMs)` after each non-no-op `send`.
- Subscribers are NOT notified for no-op actions (`ui.replace` with unknown key, `tool.result` for unknown tool).
- Unsubscribe properly removes the listener.

### 8.7 Latency histogram

- After dispatching 100 events, the header shows mean and p99 values that match a manual computation from the recorded `dispatchMs` field.

---

## 9. Implementation order (locks task decomposition for the plan)

1. Extend `AgentStore` with `subscribeAction`. Update `createAgentStore`. Add unit tests.
2. Widen `replayConversation` parameter type. Update tests if needed.
3. Build the recorder hook + types in `devtools/recorder.ts`. Unit-test it against a synthetic event stream.
4. Build `<AgentDevTools />` chrome, the scrubber, and wire to the recorder. Snapshot a basic mount test.
5. Build the Event Log (virtualized list, filters, search) and State Tree (collapsible). Test rendering against fixtures.
6. Add the `./devtools` subpath export, build, and verify in `examples/next-app/`.
7. CHANGELOG, README (new section + table row), `nextjs-app` example mounts `<AgentDevTools />`.

---

## 10. Versioning

This ships in **v0.6.2**. The bump-and-publish script doesn't need changes (the new files live inside `packages/react`).

The `AgentStore.subscribeAction` addition is a minor expansion of the published interface. We will note it in CHANGELOG under "Public API additions" with a callout that hosts implementing custom stores (if any exist outside the library) will need to add the method.
