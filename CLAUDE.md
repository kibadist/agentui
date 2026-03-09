# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm install              # Install all dependencies
pnpm build                # Build all packages (tsc)
pnpm clean                # Remove all dist/ folders
pnpm typecheck            # Type-check without emitting

pnpm dev                  # Run both NestJS (:3001) and Next.js (:3000)
pnpm dev:api              # Run NestJS backend only
pnpm dev:app              # Run Next.js frontend only
```

Per-package: `pnpm --filter @kibadist/agentui-{name} build|clean|typecheck`

No test framework is configured yet.

## Architecture

AgentUI is a monorepo (pnpm workspaces) for an AI-native React component system. LLM agents emit **typed UIEvents** via tool calls (not raw HTML), which are schema-validated and rendered through a whitelisted component registry.

**Flow**: Agent (LLM) calls `emit_ui_event` tool -> NestJS validates & streams via SSE -> React parses events -> Registry maps type to component -> User actions flow back as ActionEvents

### Package Dependency Graph

```
@kibadist/agentui-protocol  (pure TS types, zero deps)
  ├── validate              (+zod: schemas & parsers)
  ├── react                 (+react: registry, renderer, hooks, context)
  ├── nest                  (+@nestjs/common, rxjs: session bus + controller factory)
  ├── ai                    (+ai SDK: Vercel AI SDK adapter, provider-agnostic)
  └── next                  (SSE + action proxy for Next.js App Router)
```

All packages are published as `@kibadist/agentui-{name}` v0.2.2.

### Key Patterns

- **Registry pattern**: Components are whitelisted via `createRegistry(map)`. Agents can only emit registered types.
- **Fail-closed validation**: Invalid UIEvents are dropped (Zod via `safeParseUIEvent`), never best-effort fixed.
- **Session-scoped streams**: Each session gets a UUID and RxJS Subject streams for UI + Actions, with TTL cleanup (30 min default).
- **Tool-based agent interface**: LLMs call `emit_ui_event` tool instead of generating HTML. Supports multi-step tool calling.
- **SSE over WebSocket**: One-way server-to-client streaming with auto-reconnect.

### Examples

- `examples/nest-api/` - NestJS backend with DeepSeek agent (needs `DEEPSEEK_API_KEY` env var, falls back to mock mode)
- `examples/next-app/` - Next.js frontend with custom component registry

## Code Conventions

- **ESM-only**: All packages use `"type": "module"`. Relative imports use `.js` extensions.
- **TypeScript strict mode**: Target ES2022, module ESNext, bundler moduleResolution.
- **Build output**: Each package builds with `tsc` to `dist/` (JS + declarations + source maps).
- **Naming**: Factory functions (`createRegistry`, `createUIEmitterTool`, `runAgentLoop`), PascalCase types (`UIEvent`, `ActionEvent`), React hooks (`useAgentStream`, `useAgentAction`).
- **Workspace deps**: `"@kibadist/agentui-xxx": "workspace:*"` for inter-package references.
