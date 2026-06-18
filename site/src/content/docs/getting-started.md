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

# Run backend (:3001) + frontend (:3000) together
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). This runs the [clinic assistant example](./examples.md) — an agent that queries a SQLite database and renders healthcare UI.

```bash
# Or run individually
pnpm dev:api   # NestJS backend on :3001
pnpm dev:app   # Next.js frontend on :3000
```

### Optional: use a real LLM

The example works **with no API key** — the backend serves database-backed mock responses. To use a real model (Anthropic, OpenAI, DeepSeek, or Google — all supported), add a key:

```bash
cp examples/nest-api/.env.example examples/nest-api/.env
# edit examples/nest-api/.env and set ANTHROPIC_API_KEY, then restart
```

## Example Prompts

Try these once the dev server is running, or tap a suggestion chip in the UI:

```
List all patients
```
→ Renders a clickable `patient-list` roster

```
Which patients have abnormal vitals?
```
→ Renders flagged `vitals-panel`s plus a summary

```
Show me everything for patient MRN-1003
```
→ Renders a `patient-card`, `vitals-panel`, and `medication-list`

```
What appointments are scheduled this week?
```
→ Renders an `appointment-list`

## Related

- [Concepts](./concepts.md)
- [`<AgentRoot>` guide](./guides/agent-root.md)
