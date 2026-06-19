---
title: "Packages"
description: "The AgentUI monorepo publishes eight packages under the `@kibadist/agentui-*` scope."
---

| Package | npm | Purpose |
|---------|-----|---------|
| [`@kibadist/agentui-protocol`](https://www.npmjs.com/package/@kibadist/agentui-protocol) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-protocol)](https://www.npmjs.com/package/@kibadist/agentui-protocol) | TypeScript types for the wire protocol (`UIEvent`, `ActionEvent`, `UINode`) |
| [`@kibadist/agentui-validate`](https://www.npmjs.com/package/@kibadist/agentui-validate) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-validate)](https://www.npmjs.com/package/@kibadist/agentui-validate) | Zod schemas + parsers (`parseUIEvent`, `safeParseUIEvent`) |
| [`@kibadist/agentui-react`](https://www.npmjs.com/package/@kibadist/agentui-react) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-react)](https://www.npmjs.com/package/@kibadist/agentui-react) | Registry, renderer, SSE hook, action context |
| [`@kibadist/agentui-nest`](https://www.npmjs.com/package/@kibadist/agentui-nest) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-nest)](https://www.npmjs.com/package/@kibadist/agentui-nest) | Session event bus + controller factory for NestJS |
| [`@kibadist/agentui-ai`](https://www.npmjs.com/package/@kibadist/agentui-ai) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-ai)](https://www.npmjs.com/package/@kibadist/agentui-ai) | Provider-agnostic adapter via Vercel AI SDK (OpenAI, Anthropic, Google, DeepSeek) |
| [`@kibadist/agentui-llm`](https://www.npmjs.com/package/@kibadist/agentui-llm) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-llm)](https://www.npmjs.com/package/@kibadist/agentui-llm) | Provider-native LLM stream adapters (Anthropic, OpenAI, Gemini) |
| [`@kibadist/agentui-next`](https://www.npmjs.com/package/@kibadist/agentui-next) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-next)](https://www.npmjs.com/package/@kibadist/agentui-next) | SSE proxy + action proxy helpers for Next.js App Router |
| [`@kibadist/agentui-svg`](https://www.npmjs.com/package/@kibadist/agentui-svg) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-svg)](https://www.npmjs.com/package/@kibadist/agentui-svg) | SVG-native Web Components for agent workflows, timelines, approvals, memory, and state ([guide](../guides/svg-components/)) |

## Dependency graph

```mermaid
flowchart BT
  protocol["📦 protocol\n(zero deps — pure types)"]
  validate["📦 validate\n(+zod)"]
  react["📦 react\n(+react)"]
  nest["📦 nest\n(+@nestjs/common, rxjs)"]
  ai["📦 ai\n(+Vercel AI SDK)"]
  next["📦 next\n(no runtime deps)"]
  svg["📦 svg\n(zero deps — standalone Web Components)"]

  validate --> protocol
  react --> protocol
  nest --> protocol
  ai --> protocol
  next --> protocol
```

`@kibadist/agentui-svg` is standalone — framework-agnostic SVG Web Components with
no dependency on the protocol or React packages.

## Related

- [Server companion guide](../guides/server-node/)
- [LLM adapters guide](../guides/llm-adapters/)
