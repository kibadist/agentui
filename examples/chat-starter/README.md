# chat-starter

Minimal Next.js + AgentUI example. Single-process: the mock backend lives in `/api/agent/*` route handlers, no separate Nest server needed.

## Run

```bash
pnpm install            # at the repo root
pnpm build              # builds all workspace packages
pnpm --filter @kibadist/agentui-example-chat-starter dev
# open http://localhost:3010
```

## What's inside

- `app/page.tsx` — the chat UI. `useAgentStream`, `AgentRenderer`, two-component registry (`chat.message`, `chat.text`).
- `components/registry.tsx` — registers the two components.
- `app/api/agent/session/route.ts` — POST returns a fresh sessionId.
- `app/api/agent/[sessionId]/stream/route.ts` — SSE endpoint; emits a welcome message on connect; subscribes to in-process pub/sub.
- `app/api/agent/[sessionId]/action/route.ts` — receives action submits, echoes them back as `ui.append` events.

## Replacing the mock backend

Swap the route handlers for a real backend (Nest, Express, Fastify, or `@kibadist/agentui-node`'s `createAgentStream`). The client code is unchanged — it just hits whatever URL you point `useAgentStream` at.

## Deploy

This example is deployable to Vercel as-is (single-process Next.js, no external services). Run `vercel` from this directory after `pnpm install` at the workspace root.
