# State selectors

`useAgentStream` exposes a subscribable `store`; wire it into `<AgentStateProvider>` and consumers below it can subscribe to derived slices without re-rendering on unrelated events.

```tsx
function App({ url, sessionId }: { url: string; sessionId: string }) {
  const { store, status } = useAgentStream({ url, sessionId });
  return (
    <AgentStateProvider store={store}>
      <Chat />     {/* anywhere inside: useAgentNodes(), useAgentToasts(), ... */}
    </AgentStateProvider>
  );
}

function Chat() {
  const nodes  = useAgentNodes();          // re-renders only when nodes change
  const toasts = useAgentToasts();         // re-renders only when toasts change
  const count  = useAgentSelector((s) => s.nodes.length);  // arbitrary derived state
}
```

For a custom equality function (e.g., to keep a selector ref-stable across notifications):

```tsx
const status = useAgentSelector(
  (s) => ({ id: s.nodes[0]?.key ?? null }),
  (a, b) => a.id === b.id,
);
```

`useAgentStream().state` keeps working — selectors are additive. The detailing-app pattern of splitting "stream-hot" and "session-stable" contexts collapses into a single `<AgentStateProvider>`.

## Related

- [`<AgentRoot>`](./agent-root.md)
- [Testing](./testing.md)
