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

One full-featured example — a **clinic assistant** — split across two workspace packages (both `private`, not published). `pnpm dev` runs both.

- `examples/nest-api/` (`:3001`) — NestJS backend. Seeds an in-memory **SQLite** DB (`better-sqlite3`) with 5 patients + vitals/medications/appointments, exposes read-only DB query tools to the agent via `runAgentLoop`'s `extraTools`, and renders results as healthcare components. Real Anthropic via `ANTHROPIC_API_KEY` (`.env`, loaded with `--env-file-if-exists`); **DB-backed mock fallback** when unset, so it runs with zero setup. `test-client.sh` is a curl smoke test.
- `examples/next-app/` (`:3000`) — Next.js App Router frontend. Healthcare component registry (`patient-list`, `patient-card`, `vitals-panel`, `medication-list`, `appointment-list`, `text-block`) + DB-related suggestion chips. Clicking a `patient-list` row sends a `patient.view` action to drill in. Pairs with `nest-api` (`NEXT_PUBLIC_API_URL`).

The backend's allowed component types (`COMPONENT_DEFS` in `agent.service.ts`) and the frontend registry schemas (`components/schemas.ts`) mirror each other — keep them in sync when changing component props.

## Gotchas

- If a test or build fails after touching a relative import, check the `.js` extension first.
- `pnpm dev` runs `pnpm build` upfront — packages must compile before the examples can resolve them. Run `pnpm build` after editing package source if `dev` is already running.
- No CI for tests yet; run `pnpm test` locally before releasing.
