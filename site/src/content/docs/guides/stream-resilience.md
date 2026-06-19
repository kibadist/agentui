---
title: "Stream resilience"
description: "Opt-in retry, backpressure, and auth-aware reconnect for `useAgentStream`."
---

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

The client SSE parser tolerates both `LF` and `CRLF` line endings, so streams routed through proxies that rewrite to `\r\n` are decoded correctly.

## Session lifecycle (NestJS)

`AgentSessionService` expires sessions after a window of **inactivity**, not age — a session that is actively streaming (any `emitUI`/`emitAction`) keeps its idle clock reset and is never evicted mid-stream. Configure it via the constructor:

```ts
new AgentSessionService({
  ttlMs: 30 * 60_000,        // idle timeout (default 30 min)
  cleanupIntervalMs: 60_000, // sweep frequency (default 60 s)
  autoCleanup: true,         // start the sweep on construction (default true)
});
```

The cleanup sweep starts automatically and its timer is `unref`-ed, so it never blocks process exit and you can't leak sessions by forgetting to call `startCleanup()`. Pass `autoCleanup: false` to drive cleanup manually instead.

## Related

- [Server companion (Node)](../server-node/)
- [`<AgentRoot>`](../agent-root/)
