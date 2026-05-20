# Stream resilience

Opt-in retry, backpressure, and auth-aware reconnect for `useAgentStream`.

```ts
const { state, status } = useAgentStream({
  url, sessionId,
  retry: { maxAttempts: 5, initialDelayMs: 500, maxDelayMs: 30_000, jitter: "full" },
  buffer: { max: 1000, onOverflow: "drop-oldest" },
  auth: {
    getToken: () => fetchToken(),
    onUnauthorized: () => refreshSession(),
  },
});
```

`status` widens to `"idle" | "connecting" | "open" | "reauthenticating" | "reconnecting" | "closed" | "error"`. With no configs, defaults preserve previous behavior (infinite retry, unbounded buffer, no auth header).

Server-side: include an `id:` line on each event so `Last-Event-ID` reconnects can resume; return HTTP 401 to trigger `auth.onUnauthorized` + `auth.getToken`.

## Related

- [Server companion (Node)](./server-node.md)
- [`<AgentRoot>`](./agent-root.md)
