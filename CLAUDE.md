# CLAUDE.md

Guidance for Claude Code when working in this repo. Keep this file lean — only non-obvious info that can't be derived by reading the codebase.

## Project Snapshot

AgentUI is a pnpm-workspace monorepo for an AI-native React component system. LLM agents emit **typed UIEvents** through a tool call (`emit_ui_event`) instead of raw HTML; events are Zod-validated server-side and rendered through a whitelisted React component registry. User interactions return as `ActionEvent`s on the same SSE-backed session.

Flow: agent tool call → NestJS validates & streams via SSE → React parser → registry lookup → component render → action events back over POST.

## Commands

```bash
pnpm install
pnpm build         # tsc across all packages
pnpm typecheck     # no emit
pnpm clean         # remove dist/
pnpm test          # vitest run (jsdom; packages/*/test/**)
pnpm test:watch

pnpm dev           # builds, then runs the clinic example: nest-api (:3001) + next-app (:3000)
pnpm dev:api
pnpm dev:app
```

Per-package: `pnpm --filter @kibadist/agentui-<name> <script>`.

Release: `pnpm release` (patch) / `pnpm release:dry` / `./scripts/bump-and-publish.sh [patch|minor|major]`. The script typechecks, builds, bumps all package versions in sync, publishes in dependency order, commits, and tags. Push tags manually after.

## Packages

Published as `@kibadist/agentui-<name>`, all kept at the same version (currently 0.3.1, see `packages/protocol/package.json`).

```
protocol   pure TS types, zero deps
  ├── validate   +zod   schemas & parsers (safeParseUIEvent)
  ├── react      +react registry, renderer, hooks, context
  ├── nest       +@nestjs/common, rxjs   session bus + controller factory
  ├── ai         +ai SDK   Vercel AI SDK adapter, provider-agnostic
  └── next                 SSE + action proxy for Next.js App Router
```

## Conventions

- **ESM-only.** Every package has `"type": "module"`. Relative imports **must** include the `.js` extension (e.g. `import { x } from "./foo.js"`) even though the source is `.ts`. Omitting the extension breaks Node ESM resolution at runtime.
- **TypeScript strict**, target ES2022, `moduleResolution: bundler`. Each package emits JS + `.d.ts` + source maps to `dist/`.
- **Workspace deps** use `"@kibadist/agentui-<x>": "workspace:*"`.
- **Naming**: factory functions (`createRegistry`, `createUIEmitterTool`, `runAgentLoop`), PascalCase types (`UIEvent`, `ActionEvent`), `use*` for React hooks.
- **Fail-closed validation**: invalid UIEvents are dropped via `safeParseUIEvent`. Never best-effort patch malformed events.
- **Registry is the security boundary**: only types registered via `createRegistry(map)` can be emitted/rendered. Don't add escape hatches.
- **Sessions** are UUID-keyed RxJS `Subject`s for UI + Actions with a 30-min default TTL.

## Documentation is part of every change

The Starlight site at `site/src/content/docs/` (published to https://kibadist.github.io/agentui/) is the **single source of truth** for user-facing docs. Every behavior change must update the docs in the same PR — there is no separate docs follow-up step.

- **New public API** (schema field, exported function, prop, hook): add or extend a guide under `site/src/content/docs/guides/` and link it from `site/astro.config.mjs` sidebar.
- **Changed behavior** of an existing public API: update the relevant guide AND add a CHANGELOG entry at the package level.
- **New protocol op or wire-event shape**: update `site/src/content/docs/wire-protocol.md` AND a guide page if it has its own UX surface.
- **Bug fix that changes observable behavior**: update the guide that describes the affected surface; a CHANGELOG entry is enough only when behavior is unchanged.
- **Internal-only refactor** (no API or behavior change): no docs change required.

Verify with `pnpm --filter @kibadist/agentui-site build` — broken sidebar slugs or content collection schema errors fail the build.

## Examples

Two example app pairs, each split across two `private` (unpublished) workspace packages. Both follow the same architecture: a NestJS backend seeds an in-memory **SQLite** DB (`better-sqlite3`), exposes read-only query tools to the agent via `runAgentLoop`'s `extraTools`, runs real Anthropic via `ANTHROPIC_API_KEY` (`.env`, `--env-file-if-exists`) with a **DB-backed mock fallback** when unset (zero-setup), and a Next.js App Router frontend renders a whitelisted registry + chips/quick-actions, wired over SSE (`NEXT_PUBLIC_API_URL`).

**Clinic assistant** (`pnpm dev`) — healthcare React components.
- `examples/nest-api/` (`:3001`) — 5 patients + vitals/medications/appointments. `test-client.sh` is a curl smoke test.
- `examples/next-app/` (`:3000`) — registry (`patient-list`, `patient-card`, `vitals-panel`, `medication-list`, `appointment-list`, `text-block`) + suggestion chips. Clicking a `patient-list` row sends a `patient.view` action.

**Agent observability** (`pnpm dev:svg`) — renders the SVG-native Web Components from `@kibadist/agentui-svg`.
- `examples/svg-api/` (`:3003`) — seeds an "agent runs" DB (3 recorded runs: deploy-investigation, intake-summary, competitor-research) with steps/edges/memory/states; `list_runs`/`get_run` tools.
- `examples/svg-app/` (`:3002`) — registry of thin React wrappers around the custom elements (`workflow-canvas`, `tool-timeline`, `review-checkpoint`, `memory-map`, `state-machine`, `text-block`) + quick-action buttons. The SVG package is **registered client-side only** (its classes extend `HTMLElement`, undefined during SSR — see `components/svg-element.tsx`, dynamic `import("@kibadist/agentui-svg/register")` in an effect). Selecting a node/item/state sends an `agent.inspect` action; checkpoint decisions send `agent.decision`.

In each pair the backend's allowed component types (`COMPONENT_DEFS` in `agent.service.ts`) and the frontend registry schemas (`components/schemas.ts`) mirror each other — keep them in sync when changing component props.

## Gotchas

- If a test or build fails after touching a relative import, check the `.js` extension first.
- `pnpm dev` runs `pnpm build` upfront — packages must compile before the examples can resolve them. Run `pnpm build` after editing package source if `dev` is already running.
- No CI for tests yet; run `pnpm test` locally before releasing.
