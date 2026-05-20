# Migration guide: 0.x → 1.0

This guide covers breaking changes between the last 0.x release and v1.0. None of the changes are large; most consumers can migrate with a single search-and-replace per item.

## Quick summary

| What changed | Action |
|---|---|
| `initialAgentState` constant removed | Replace with `createInitialAgentState()` |
| Public extension points formalized | See [STABILITY.md](./STABILITY.md) — no behavior change, just documentation |
| All other 0.x APIs are preserved | No action needed |

## Detailed changes

### `initialAgentState` removed (`@kibadist/agentui-react`)

The `initialAgentState` constant was deprecated in v0.3 in favor of `createInitialAgentState()`. It returned a single shared object whose `Map` instances were reused across resets, which could alias state between sessions in tests.

```ts
// Before
import { initialAgentState } from "@kibadist/agentui-react";
const state = initialAgentState;

// After
import { createInitialAgentState } from "@kibadist/agentui-react";
const state = createInitialAgentState();
```

If you were using it in a long-lived reducer dispatch, prefer calling the factory once at module load:

```ts
// Module scope — factory returns fresh state each time, so call once.
const INITIAL = createInitialAgentState();
```

### Stability promise (no code change)

The set of stable extension points (`Registry`, `ComponentSpec`, `SessionStorageAdapter`, `ConversationStorage`, public hooks, top-level components) is now documented in [STABILITY.md](./STABILITY.md). The contract is unchanged from 0.9.x — this just makes it explicit so third parties know what they can build on.

A small number of items remain experimental (`AgentDevTools`, `AgentRootRegistry` internals, `metrics` shape) — see STABILITY.md for the list.

## Migration steps

1. `grep -rn "initialAgentState" .` — replace each usage with `createInitialAgentState()`.
2. `pnpm install @kibadist/agentui-react@1.0.0` (and the other `@kibadist/agentui-*` packages).
3. Run your test suite. If anything breaks, open an issue tagged `stability` — we treat that as a contract bug.

## Not in this migration

- The wire protocol is unchanged from 0.9.x.
- All hook signatures and return shapes are unchanged.
- All component prop shapes are unchanged.
- `<AgentRoot>` and the session lifecycle are unchanged.
- The `@kibadist/agentui-llm` and `@kibadist/agentui-node` packages have no breaking changes.

## Future plans (not in 1.0)

- A formal `StreamTransport` interface for plugging in non-SSE transports (WebSocket, long-poll). Tracked separately.
- Codemods for any future breaking changes. We will ship one alongside the next major.
