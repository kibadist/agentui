# agentui

An AI-native, agent-friendly React component system. Instead of letting a model generate raw HTML/JSX, the agent emits **typed UI events** that are schema-validated and rendered through a whitelisted component registry.

```
Agent (LLM) ──emit_ui_event──> NestJS ──SSE──> React ──registry──> Components
     ^                                                                   │
     └──────────────────── ActionEvent <── user click ───────────────────┘
```

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9 (`corepack enable` to auto-install)

## Quick start

```bash
# Clone and install
git clone <repo-url> agentui
cd agentui
pnpm install

# Build all packages
pnpm build

# Add your DeepSeek key (or leave blank for mock mode)
echo "DEEPSEEK_API_KEY=sk-your-key-here" > examples/nest-api/.env
echo "PORT=3001" >> examples/nest-api/.env

# Run both examples (backend :3001 + frontend :3000)
pnpm dev
```

Open http://localhost:3000 and try these prompts:

```
Show me a summary of recent sales
```
```
Compare pricing plans for a SaaS product in a table
```
```
List the top 5 programming languages with their pros and cons
```
```
Show system health status for production servers
```
```
Create a project task board with backlog, in progress, and done columns
```

### Run individually

```bash
pnpm dev:api   # just the NestJS backend on :3001
pnpm dev:app   # just the Next.js frontend on :3000
```

## Packages

| Package | Purpose |
|---|---|
| [`@kibadist/agentui-protocol`](https://www.npmjs.com/package/@kibadist/agentui-protocol) | TypeScript types for the wire protocol (UIEvent, ActionEvent, UINode) |
| [`@kibadist/agentui-validate`](https://www.npmjs.com/package/@kibadist/agentui-validate) | Zod schemas + parsers (`parseUIEvent`, `safeParseUIEvent`, etc.) |
| [`@kibadist/agentui-react`](https://www.npmjs.com/package/@kibadist/agentui-react) | Registry, renderer, SSE hook, action context for React apps |
| [`@kibadist/agentui-nest`](https://www.npmjs.com/package/@kibadist/agentui-nest) | Session event bus + controller factory for NestJS |
| [`@kibadist/agentui-openai`](https://www.npmjs.com/package/@kibadist/agentui-openai) | Tool-call adapter for OpenAI-compatible APIs (GPT, DeepSeek, etc.) |
| [`@kibadist/agentui-ai`](https://www.npmjs.com/package/@kibadist/agentui-ai) | Provider-agnostic adapter via Vercel AI SDK (OpenAI, Anthropic, Google, etc.) |
| [`@kibadist/agentui-next`](https://www.npmjs.com/package/@kibadist/agentui-next) | SSE proxy + action proxy helpers for Next.js App Router |

### Dependency graph

```
@kibadist/agentui-protocol          (zero deps — pure types)
     ├── @kibadist/agentui-validate (+zod)
     ├── @kibadist/agentui-react    (+react)
     ├── @kibadist/agentui-nest     (+@nestjs/common, rxjs)
     ├── @kibadist/agentui-openai   (+openai)
     ├── @kibadist/agentui-ai      (+ai)
     └── @kibadist/agentui-next     (no runtime deps)
```

## Using in your own project

### 1. Backend (NestJS)

Install the packages:

```bash
pnpm add @kibadist/agentui-protocol @kibadist/agentui-validate @kibadist/agentui-nest @kibadist/agentui-openai openai
```

Create a service that wires the agent loop to the session bus:

```ts
// agent.service.ts
import { Injectable } from "@nestjs/common";
import OpenAI from "openai";
import { AgentSessionService } from "@kibadist/agentui-nest";
import { runAgentLoop } from "@kibadist/agentui-openai";
import type { ActionEvent } from "@kibadist/agentui-protocol";

@Injectable()
export class AgentService {
  readonly sessionService = new AgentSessionService();
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com",
    });
    this.sessionService.startCleanup();
  }

  async handleAction(sessionId: string, action: ActionEvent) {
    const message = (action.payload?.message as string) ?? action.name;

    await runAgentLoop({
      openai: this.openai,
      model: "deepseek-chat",
      systemPrompt: "You are a helpful assistant. Use emit_ui_event to render UI.",
      userMessage: message,
      allowedTypes: ["text-block", "info-card", "data-table"],
      sessionId,
      onUIEvent: (event) => this.sessionService.emitUI(sessionId, event),
    });
  }
}
```

Create a controller using the factory:

```ts
// agent.controller.ts
import { Controller, Post, Param, Body, Sse, Inject } from "@nestjs/common";
import { createAgentController } from "@kibadist/agentui-nest";
import { AgentService } from "./agent.service";

@Controller("agent")
export class AgentController {
  private handlers;

  constructor(@Inject(AgentService) private agentService: AgentService) {
    this.handlers = createAgentController({
      sessionService: agentService.sessionService,
      onAction: (id, action) => agentService.handleAction(id, action),
    });
  }

  @Post("session")
  createSession() {
    return this.handlers.createSession();
  }

  @Sse(":sessionId/stream")
  stream(@Param("sessionId") id: string) {
    return this.handlers.stream(id);
  }

  @Post(":sessionId/action")
  action(@Param("sessionId") id: string, @Body() body: unknown) {
    return this.handlers.action(id, body);
  }
}
```

This gives you three endpoints:
- `POST /agent/session` — creates a session, returns `{ sessionId }`
- `GET /agent/:sessionId/stream` — SSE stream of `UIEvent`s
- `POST /agent/:sessionId/action` — accepts `ActionEvent`s from the frontend

### 2. Frontend (React / Next.js)

Install the packages:

```bash
pnpm add @kibadist/agentui-protocol @kibadist/agentui-react @kibadist/agentui-validate
```

Define a component registry — this is the allowlist of components the agent can render:

```tsx
// components/registry.ts
import { createRegistry } from "@kibadist/agentui-react";
import { TextBlock } from "./text-block";
import { InfoCard } from "./info-card";
import { DataTable } from "./data-table";

export const registry = createRegistry({
  "text-block": { component: TextBlock },
  "info-card":  { component: InfoCard },
  "data-table": { component: DataTable },
});
```

Each component receives props from the agent. For example:

```tsx
// components/text-block.tsx
export function TextBlock({ title, body }: { title?: string; body: string }) {
  return (
    <div>
      {title && <h3>{title}</h3>}
      <p>{body}</p>
    </div>
  );
}
```

Wire it up with the SSE hook and renderer:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import type { ActionEvent } from "@kibadist/agentui-protocol";
import { useAgentStream, AgentRenderer, AgentActionProvider } from "@kibadist/agentui-react";
import { registry } from "./components/registry";

const API = "http://localhost:3001";

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/agent/session`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => setSessionId(data.sessionId));
  }, []);

  if (!sessionId) return <p>Connecting...</p>;

  return <AgentView sessionId={sessionId} />;
}

function AgentView({ sessionId }: { sessionId: string }) {
  const { state, status } = useAgentStream({
    url: `${API}/agent/${sessionId}/stream`,
    sessionId,
  });

  const sender = useCallback(async (action: ActionEvent) => {
    await fetch(`${API}/agent/${sessionId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
  }, [sessionId]);

  return (
    <AgentActionProvider sender={sender}>
      <p>Status: {status}</p>
      <AgentRenderer state={state} registry={registry} />
    </AgentActionProvider>
  );
}
```

### 3. Optional: Next.js BFF proxy

If you want the Next.js app to proxy requests to the NestJS backend (for auth, cookies, etc.), use `@kibadist/agentui-next`:

```bash
pnpm add @kibadist/agentui-next
```

```ts
// app/api/agent/[sessionId]/stream/route.ts
import { createSSEProxyHandler } from "@kibadist/agentui-next";

export const GET = createSSEProxyHandler({
  targetUrl: "http://localhost:3001",
  getHeaders: (req) => ({
    Authorization: req.headers.get("cookie") ?? "",
  }),
});
```

```ts
// app/api/agent/[sessionId]/action/route.ts
import { createActionProxyHandler } from "@kibadist/agentui-next";

export const POST = createActionProxyHandler({
  targetUrl: "http://localhost:3001",
});
```

Then point your frontend at `/api/agent` instead of the NestJS URL directly.

### 4. Using a different LLM provider

`@kibadist/agentui-openai` works with any OpenAI-compatible API. Just change `baseURL`:

```ts
// DeepSeek
new OpenAI({ apiKey: "sk-...", baseURL: "https://api.deepseek.com" });

// OpenAI
new OpenAI({ apiKey: "sk-..." });

// Local (Ollama, vLLM, etc.)
new OpenAI({ apiKey: "none", baseURL: "http://localhost:11434/v1" });
```

Then pass the client to `runAgentLoop` with the appropriate `model` name.

## Protocol

The agent communicates via **UI patch events** over SSE. The UI is a list of `UINode`s, keyed by `key`.

### Patch operations

| Op | Description |
|---|---|
| `ui.append` | Add a node to the render list |
| `ui.replace` | Update an existing node's props (shallow merge by default, full replace with `replace: true`) |
| `ui.remove` | Remove a node by key |
| `ui.toast` | Show an ephemeral notification (not stored in the render list) |
| `ui.navigate` | Trigger client-side navigation |

### UINode shape

```ts
{
  key: string;         // stable identity for patching
  type: string;        // registry key, e.g. "data-table"
  props: Record<string, unknown>;
  slot?: string;       // optional layout slot filtering
}
```

### Action events (user to agent)

Components dispatch actions back to the agent via `useAgentAction()`:

```ts
{
  v: 1,
  id: "uuid",
  ts: "2025-01-01T00:00:00Z",
  sessionId: "...",
  kind: "action",
  type: "action.submit",     // or "action.select", "action.approve"
  name: "purchase.confirm",  // stable action identifier
  payload: { ... },          // arbitrary data
}
```

### Validation

All events are validated with Zod before rendering. Invalid events are dropped — never "best-effort" fixed:

```ts
import { safeParseUIEvent } from "@kibadist/agentui-validate";

const result = safeParseUIEvent(raw);
if (result.ok) {
  // result.value is a typed UIEvent
} else {
  // result.error describes what's wrong
}
```

## Project structure

```
agentui/
  packages/
    protocol/       # TypeScript types (zero runtime)
    validate/       # Zod schemas + parse/safeParse
    react/          # Registry, renderer, hooks, context
    nest/           # Session bus + controller factory
    openai/         # Tool-call adapter for OpenAI-compatible APIs
    next/           # SSE + action proxy for Next.js App Router
  examples/
    nest-api/       # Working NestJS backend (DeepSeek)
    next-app/       # Working Next.js frontend
```

## Scripts

| Command | Description |
|---|---|
| `pnpm install` | Install all dependencies |
| `pnpm build` | Build all packages |
| `pnpm dev` | Build + run both examples |
| `pnpm dev:api` | Run nest-api only (port 3001) |
| `pnpm dev:app` | Run next-app only (port 3000) |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm clean` | Remove all dist/ folders |

## Environment variables

### `examples/nest-api/.env`

| Variable | Required | Description |
|---|---|---|
| `DEEPSEEK_API_KEY` | No | DeepSeek API key. Without it, the server runs in mock mode. |
| `PORT` | No | Server port (default: 3001) |

### `examples/next-app`

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | Backend URL (default: `http://localhost:3001`) |
