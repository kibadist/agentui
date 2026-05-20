# Renderer

`<AgentRenderer>` accepts five optional props for slicing, hiding, error containment, and wrapping (e.g., for animation).

```tsx
<AgentRenderer
  state={state}
  registry={registry}
  range={{ start: lastSeenIndex, end: state.nodes.length }}   // paginate
  hiddenTypes={['panel-patch']}                               // hide structural nodes
  errorFallback={(err, node) => <ErrorCard message={err.message} nodeKey={node.key} />}
  nodeWrapper={(node, children) => (
    <motion.div key={node.key} layout>{children}</motion.div>
  )}
/>
```

Composition order is `slot → range → filter → hiddenTypes`. All five default to no-op, so existing call sites need no changes.

## Related

- [`<AgentRoot>`](./agent-root.md)
- [State selectors](./state-selectors.md)
