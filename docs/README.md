# AgentUI Documentation

This directory contains the long-form docs for AgentUI. The project [`README.md`](../README.md) mirrors this index for the GitHub landing page.

## Start here

- [Getting Started](./getting-started.md) — prereqs, install, dev server, first prompt
- [Concepts](./concepts.md) — the problem, the typed-event approach, the flow
- [Wire Protocol](./wire-protocol.md) — every operation, with payload examples

## Guides

### Client (`@kibadist/agentui-react`)

- [`<AgentRoot>`](./guides/agent-root.md) — top-level provider, multi-agent namespacing
- [Renderer](./guides/renderer.md) — `<AgentRenderer>` props
- [State selectors](./guides/state-selectors.md) — `useAgentNodes`, `useAgentSelector`, etc.
- [Tool calls](./guides/tool-calls.md) — `<ToolCallStream>`, `useToolCall`
- [Reasoning](./guides/reasoning.md) — `useReasoning`, `useLatestReasoning`
- [Workflows](./guides/workflows.md) — `<WorkflowStepper>`, `useWorkflow`
- [Optimistic updates](./guides/optimistic.md) — `useOptimistic`
- [Schema-first nodes](./guides/schema-first-nodes.md) — `defineNode`
- [Stream resilience](./guides/stream-resilience.md) — retry, backpressure, auth
- [Memory caps & metrics](./guides/memory-caps.md) — bounded state, observability
- [Testing](./guides/testing.md) — `createMockAgentStream`
- [DevTools](./guides/devtools.md) — `<AgentDevTools>` panel

### Server

- [Server companion (Node)](./guides/server-node.md) — `@kibadist/agentui-node`
- [LLM adapters](./guides/llm-adapters.md) — `@kibadist/agentui-llm`
- [JSON Schema export](./guides/json-schema-export.md) — for non-TS consumers

### Tooling

- [CLI generator](./guides/cli-generator.md) — scaffold a typed node

## Reference

- [Packages](./packages.md) — full package matrix + dependency graph
- [Use Cases](./use-cases.md)
- [Roadmap](./roadmap.md)
