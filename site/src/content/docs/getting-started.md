---
title: "Getting Started"
description: "Install dependencies, configure an API key, and run the dev server."
---

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9 (`corepack enable` to auto-install)

## Install & Run

```bash
# Clone and install
git clone https://github.com/kibadist/agentui
cd agentui
pnpm install

# Build all packages
pnpm build

# Add your API key (Anthropic, OpenAI, DeepSeek, or Google — all supported)
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" > examples/nest-api/.env
echo "PORT=3001" >> examples/nest-api/.env

# Run backend (:3001) + frontend (:3000) together
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
# Or run individually
pnpm dev:api   # NestJS backend on :3001
pnpm dev:app   # Next.js frontend on :3000
```

## Try it live

No clone required — the [`chat-starter`](https://github.com/kibadist/agentui/tree/main/examples/chat-starter) example runs in your browser below. It uses a mock SSE backend (in-process Next.js route handlers), so there's no API key to set. Send a message, then edit `app/page.tsx` or `components/registry.tsx` and watch the change reflect live.

<iframe
  title="AgentUI chat-starter — live StackBlitz playground"
  src="https://stackblitz.com/github/kibadist/agentui/tree/main/examples/chat-starter?embed=1&file=app%2Fpage.tsx&view=preview&hideNavigation=1&theme=dark"
  loading="lazy"
  style="width:100%;height:640px;border:1px solid var(--sl-color-gray-5);border-radius:8px;"
  allow="cross-origin-isolated"
></iframe>

> Cold boots take a few seconds while StackBlitz installs the published `@kibadist/agentui-*` packages. If the embed doesn't load, [open it in a new tab](https://stackblitz.com/github/kibadist/agentui/tree/main/examples/chat-starter?file=app%2Fpage.tsx).

## Example Prompts

Try these once you have the dev server running:

```
Show me a summary of recent sales
```
→ Renders a `stat-card` grid + `data-table`

```
Compare pricing plans for a SaaS product
```
→ Renders a structured comparison `data-table`

```
Create a project task board with backlog, in progress, and done columns
```
→ Renders a `task-board` with draggable cards

```
Show system health status for production servers
```
→ Renders `stat-card` components with live-style indicators

## Related

- [Concepts](./concepts.md)
- [`<AgentRoot>` guide](./guides/agent-root.md)
