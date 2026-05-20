# Testing helpers

`@kibadist/agentui-react/testing` ships drop-in mocks for vitest setups.

```tsx
import { createMockAgentStream } from "@kibadist/agentui-react/testing";
import { AgentStateProvider, useAgentNodes } from "@kibadist/agentui-react";

const mock = createMockAgentStream();

render(
  <AgentStateProvider store={mock.store}>
    <YourComponent />     {/* anywhere inside: useAgentNodes(), etc. */}
  </AgentStateProvider>,
);

act(() => {
  mock.push({ v: 1, op: "ui.append", node: { key: "a", type: "card", props: {} }, id: "e1", ts: "...", sessionId: "s" });
  mock.setStatus("open");
});

expect(mock.state.nodes).toHaveLength(1);
expect(mock.history).toHaveLength(1);
```

Also exposes `pushEvent(state, event)` and `replayConversation(events)` for pure reducer-level tests, and `createTestRegistry(map)` (a Registry that renders `<span data-testid="test-marker-{type}">` for unregistered types).

## Related

- [State selectors](./state-selectors.md)
- [DevTools](./devtools.md)
