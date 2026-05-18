# AgentRenderer ergonomics (DET-135 / v0.4.1)

Linear: [DET-135 — v0.4 — Renderer: range / filter / hiddenTypes / errorFallback / nodeWrapper props](https://linear.app/detailing-app/issue/DET-135)

## Goal

Extend `AgentRenderer` with five additive props so consumers stop wrapping it. The detailing-app currently maintains a custom `SlicedAgentRenderer` plus per-node `<ErrorBoundary>` wrappers plus a `panel-patch` `hiddenTypes` filter — all of which collapse to props once this lands.

## Non-goals

- Animation primitives. `nodeWrapper` is the seam; consumers bring framer-motion or whatever they want.
- Reworking `propsSchema` failure handling. Current behavior (warn in dev, skip) is unchanged.
- Renderer state. The renderer stays pure: props in, JSX out.
- Lifting the derivation pipeline into a standalone hook. That belongs in DET-136 (granular selectors), not here.

## Public API

```ts
// packages/react/src/renderer.tsx

export interface AgentRendererProps {
  state: AgentState;
  registry: Registry;
  /** Only render nodes matching this slot (undefined = all). */
  slot?: string;
  /** Rendered when a node type is not in the registry. */
  fallback?: (node: UINode) => ReactNode;

  // NEW (all default to no-op)

  /** Half-open slice over the post-slot list. Missing bounds default to 0 / length. */
  range?: { start?: number; end?: number };

  /**
   * Predicate run after range. Receives the node and its index in the
   * post-slot (pre-range) array — i.e., the node's logical position in
   * its slot, stable as `range` changes.
   */
  filter?: (node: UINode, index: number) => boolean;

  /** Convenience exclusion set. Applied last; cannot be bypassed by `filter`. */
  hiddenTypes?: ReadonlyArray<string>;

  /**
   * If set, each rendered node is wrapped in an internal error boundary
   * that invokes this on a render error. If omitted, errors propagate
   * (current behavior — no boundary, no reconciliation overhead).
   */
  errorFallback?: (err: Error, node: UINode) => ReactNode;

  /**
   * Wraps each rendered node. Useful for `<AnimatePresence>`-style
   * mount/unmount tracking. The wrapper is the outermost layer per node
   * (sits outside the error boundary), so it remains mounted even if the
   * inner component throws.
   */
  nodeWrapper?: (node: UINode, children: ReactNode) => ReactNode;
}
```

## Pipeline

Composition order, top-down:

```
state.nodes
  → slot filter         (existing: keep only nodes whose .slot matches)
  → range slice         (start ?? 0, end ?? length; clamped to bounds; half-open)
  → filter callback     (predicate: false = skip; index is post-slot, pre-range)
  → hiddenTypes         (exclude any node whose .type is in the set)
  → for each survivor:
      registry lookup
        miss → fallback(node) | dev-warn + null
        hit  → optional propsSchema validation (warn + null on fail)
               createElement(spec.component, { key: node.key, ...node.props })
      wrap → errorFallback ? <NodeErrorBoundary onError={errorFallback} node>{el}</…> : el
      wrap → nodeWrapper ? nodeWrapper(node, el) : el
      (key always on the outermost element)
```

### Why slot first

`slot` is an existing categorical pre-filter (chat panel vs. side panel, etc.). `range` operates within a slot. Hosts wanting "the second page of slot A" pass `slot='A'` and `range={{ start: 10, end: 20 }}` and get exactly that.

### Why the index given to `filter` is post-slot, pre-range

Three reasons:

1. It matches the index that survives across `range` changes — a predicate like "skip even-indexed nodes" doesn't flicker when the host pages.
2. It correlates with `state.byKey` when `slot` is unset (since `byKey` indexes into `state.nodes`).
3. The alternative — post-range local index — is recoverable by the host via `Array.indexOf`; the pre-range index is not.

Documented in the JSDoc.

### Why `hiddenTypes` is last (and additive to `filter`)

If `hiddenTypes` ran before `filter`, a host could accidentally re-admit a hidden type via a buggy `filter`. Running `hiddenTypes` last means it's a hard exclusion — exactly the contract for "this type is structural plumbing, never render it."

## ErrorBoundary

```tsx
// internal, not exported
class NodeErrorBoundary extends React.Component<{
  fallback: (err: Error) => ReactNode;
  children: ReactNode;
}, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error
      ? this.props.fallback(this.state.error)
      : this.props.children;
  }
}
```

Opt-in: the renderer only instantiates this when `errorFallback` is passed. Otherwise the per-node element is returned directly — bytewise identical to today's renderer.

No `componentDidCatch` logging by default. If the host wants to log, they do it inside `errorFallback`.

## `nodeWrapper` placement

```
nodeWrapper(node, ErrorBoundary(errorFallback)(component))
```

Wrapper outside, boundary inside. The wrapper has the React key. Reason:

- Hosts using `<AnimatePresence>` mount each child by key and run exit animations on unmount. If the inner component throws and the boundary swallows it, the wrapper must still be present in the tree — otherwise framer-motion sees the key disappear and yanks the animation.
- If we instead put the boundary outside, a throw would unmount the wrapper, which then re-mounts on rerender. That's a visual flicker for no benefit.

## Behavior matrix

| Props supplied | Behavior |
|---|---|
| none (today) | identical to current renderer |
| `slot` only | filter by slot (today) |
| `range` only | slice |
| `filter` only | predicate |
| `hiddenTypes` only | exclusion |
| `slot + range + filter + hiddenTypes` | applied in that order |
| `errorFallback` | each node wrapped in boundary; siblings unaffected by one node's throw |
| `nodeWrapper` | each rendered node passed through wrapper; key on the wrapper element |
| `errorFallback + nodeWrapper` | wrapper outside, boundary inside |
| `fallback` (existing) | rendered when registry misses; still passes through `nodeWrapper` if set |

## Edge cases

- **Empty range:** `range={{ start: 5, end: 5 }}` → nothing renders. No error.
- **Out-of-bounds range:** clamped. `range={{ start: -3, end: 999 }}` over a 4-node list → renders all 4.
- **`start > end`:** treated as empty (no throw — invalid input from a host is not a crash condition).
- **`filter` throws:** propagates. Predicates are host code; we don't try to be defensive about them.
- **`nodeWrapper` returns null/undefined:** rendered as nothing for that node; no crash.
- **`errorFallback` itself throws:** propagates to the nearest outer boundary. Not our job to catch errors in error handlers.

## File touches

- `packages/react/src/renderer.tsx` — main change.
- `packages/react/test/renderer.test.tsx` — new test file (five tests, see below).
- `packages/react/src/index.ts` — no new exports needed; only the prop interface widens, and it's already inferred via `AgentRenderer`'s component signature. (Explicit `AgentRendererProps` export remains as-is if present, otherwise add it for consumer typing.)
- `CHANGELOG.md` — `0.4.0` entry.
- `README.md` — short subsection under "Supported UI Operations" with a `hiddenTypes` example, since that's the most likely first-touch use.

## Tests

New file: `packages/react/test/renderer.test.tsx`. Five tests, each isolating one prop and one of the ticket's required cases:

1. **range** — render 7 nodes, pass `range={{ start: 2, end: 5 }}`, assert only nodes at indices 2, 3, 4 appear (by `data-testid` or text content).
2. **hiddenTypes** — render 3 nodes typed `['a', 'panel-patch', 'c']`, pass `hiddenTypes={['panel-patch']}`, assert `'a'` and `'c'` render in order.
3. **filter ref stability** — render 4 nodes, pass a stable `filter` function (defined in the test scope, not inline), rerender with the same `state`/`filter`, assert the rendered DOM is structurally identical (same keys in the same order). Also assert `filter` is called with the documented (node, index) pairs.
4. **errorFallback** — register a component that throws on a specific node's props, pass `errorFallback={(err, node) => <span data-test={node.key}>err</span>}`, assert the fallback renders for that node and the siblings render normally. A control test without `errorFallback` asserts the throw propagates (caught by `expect(...).toThrow()` wrapping a manual render).
5. **nodeWrapper** — pass `nodeWrapper={(node, children) => <div data-wrap={node.key}>{children}</div>}`, assert each rendered node has a `data-wrap={node.key}` ancestor and that `children` is the actual component output.

### What we don't test

- Slot — covered by existing behavior; no change.
- Registry miss / propsSchema warn — unchanged code paths.
- Composition with `<AgentUIProvider>` — orthogonal.

## Migration / changelog

```md
## 0.4.0

### Added — `@kibadist/agentui-react`

- `AgentRenderer` gains `range`, `filter`, `hiddenTypes`, `errorFallback`, `nodeWrapper` props.
  Composition order: slot → range → filter → hiddenTypes. All five default to no-op;
  callers that don't pass them see identical behavior to 0.3.x.
  - Replaces hand-rolled `SlicedAgentRenderer` wrappers, per-node `<ErrorBoundary>`s, and
    `hiddenTypes` array prop drilling.

### Behavior

- The internal error boundary only attaches when `errorFallback` is set — there is no
  reconciliation overhead for consumers who don't use it.
- `nodeWrapper` is the outermost layer per node; it stays mounted even when the inner
  component throws and is caught by `errorFallback`.
```

## Open questions

None blocking. Two items I'm deciding inline rather than punting:

- **Should `AgentRendererProps` be exported?** Yes — type-only export from `index.ts`. Hosts that wrap `AgentRenderer` (e.g., for default props) need it. Cheap to add.
- **Should the pipeline be memoized?** No. The input array (`state.nodes`) is reducer-driven and reference-stable when nothing changed; React reconciles by `node.key` regardless. Adding `useMemo` would be machinery without measurable win.
