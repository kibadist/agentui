---
title: "Optimistic updates"
description: "Apply local patches before the server confirms, then drop the patch on `optimistic.confirm` or revert on `optimistic.rollback`. Events flow in both directions: the host dispatches `apply` to overlay an entity's UI, and the server emits `confirm`/`rollback` once it processes the action."
---

```tsx
import {
  AgentStateProvider,
  useAgentStream,
  useOptimistic,
} from "@kibadist/agentui-react";

function QuoteStatusPill({ quoteId, canonical }: { quoteId: string; canonical: { status: string } }) {
  const optimistic = useOptimistic(`quote:${quoteId}`);
  const status = (optimistic?.status as string) ?? canonical.status;
  return <span data-status={status}>{status}</span>;
}

function ConfirmButton({ quoteId, sessionId }: { quoteId: string; sessionId: string }) {
  const { dispatch } = useAgentStream({ url: "/api/agent", sessionId });
  return (
    <button
      onClick={async () => {
        const originId = crypto.randomUUID();
        dispatch({
          v: 1,
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          sessionId,
          op: "optimistic.apply",
          entityKey: `quote:${quoteId}`,
          patch: { status: "confirmed" },
          originId,
          ttlMs: 5000,
        });
        // Then fire your real action; on success the server emits
        // optimistic.confirm; on failure it emits optimistic.rollback.
      }}
    >
      Confirm
    </button>
  );
}
```

`confirm` and `rollback` both remove the entry — the semantic difference is host-side intent (telemetry, success/error animation). The library does **not** start TTL timers; if you want client-side expiry, watch `useOptimisticAll()` from a `useEffect` and dispatch `optimistic.rollback` when an entry's `expiresAt` passes.

## Related

- [Tool calls](./tool-calls.md)
