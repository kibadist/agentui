# Contributing to AgentUI

Thanks for your interest in contributing. AgentUI is a TypeScript monorepo for a typed, AI-native React component system. This document covers the practical workflow: local setup, the test bar, PR conventions, releases, and how to extend the repo.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). By participating, you agree to uphold its terms. Report issues to `kibadist@gmail.com`.

## Local setup

Prereqs:

- Node 20 or later
- pnpm 9 or later (`corepack enable` then `corepack prepare pnpm@latest --activate`)

Bootstrap:

```bash
git clone https://github.com/kibadist/agentui.git
cd agentui
pnpm install
pnpm build
pnpm test
```

Common loops:

```bash
pnpm typecheck        # tsc --noEmit across the workspace
pnpm build            # tsc emit for every package
pnpm clean            # remove all dist/ output
pnpm test             # vitest run (jsdom; packages/*/test/**)
pnpm dev              # builds, then runs nest-api (:3001) + next-app (:3000)
pnpm dev:api          # nest example only
pnpm dev:app          # next example only
```

Per-package scripts:

```bash
pnpm --filter @kibadist/agentui-react test
pnpm --filter @kibadist/agentui-protocol build
```

Starter templates (under `examples/`) get their own dev ports:

| Example          | Port |
| ---------------- | ---- |
| `next-app`       | 3000 |
| `nest-api`       | 3001 |
| `chat-starter`   | 3010 |
| `support-bot`    | 3011 |
| `internal-tools` | 3012 |

## Test bar

We are strict about tests because the wire protocol is the trust boundary.

- **New behavior requires a unit test.** No exceptions for protocol changes, reducer changes, validation rules, or hook behaviors.
- **Bug fixes require a regression test.** Reproduce the bug as a failing test first, then make it pass.
- **Run `pnpm test` (one-shot) before opening a PR.** Do not rely on `pnpm test:watch` — watch mode does not surface flaky tests reliably in this repo.
- **Tests live under `packages/*/test/**`** and are discovered by the root `vitest.config.ts`. Examples are not under test (vitest does not match `examples/`); they only need to typecheck.

## TypeScript conventions

- **ESM-only.** Every package is `"type": "module"`. Relative imports in `.ts` / `.tsx` sources **must** include the `.js` extension (e.g. `import { x } from "./foo.js"`). Omitting the extension breaks Node ESM resolution at runtime.
- **Strict mode.** `tsconfig.base.json` enables `strict: true`. Do not weaken it locally.
- **Target ES2022, `moduleResolution: "bundler"`.** Each package emits JS, `.d.ts`, and source maps to `dist/`.
- **Workspace deps** use `"@kibadist/agentui-<x>": "workspace:*"`.
- **Naming.** Factory functions (`createRegistry`, `createUIEmitterTool`, `runAgentLoop`); PascalCase types (`UIEvent`, `ActionEvent`); `use*` for React hooks.
- **Fail-closed validation.** Invalid UIEvents are dropped via `safeParseUIEvent`. Never best-effort patch malformed events.
- **Registry is the security boundary.** Only types registered via `createRegistry(map)` can be emitted or rendered. Do not add escape hatches.

## PR conventions

- **Branch off `main`.** Keep PRs focused; one logical change per PR.
- **Conventional Commits.** Use the form `<type>(<scope>): <summary>`.
  - Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.
  - Scope: the package directory name (`protocol`, `validate`, `react`, `nest`, `ai`, `next`, `examples`, `repo`).
  - Breaking changes: append `!` after the scope (e.g. `feat(protocol)!: ...`) and add a `BREAKING CHANGE:` footer.
  - Examples:
    - `feat(react): add useToolCalls selector`
    - `fix(validate): drop unknown UI op instead of throwing`
    - `docs(readme): document AgentRoot endpoint shape`
- **Link tickets.** If the change has a Linear ticket, include `DET-NNN` in the PR description.
- **Use the PR template.** The repo ships `.github/pull_request_template.md`; fill in the test plan and breaking-change sections honestly.
- **Pass `pnpm typecheck && pnpm build && pnpm test`** locally before requesting review.

## Wire-protocol changes need an RFC

The wire protocol (the union type `AgentWireEvent` in `@kibadist/agentui-protocol`) and the public hook surface of `@kibadist/agentui-react` are load-bearing across consumers. Material changes to either must go through the RFC process described in [`rfcs/README.md`](./rfcs/README.md). In short:

1. Open a PR adding `rfcs/NNNN-short-name.md` (copy from `rfcs/0000-template.md`).
2. Tag the PR with the `RFC` label.
3. Wait for at least one maintainer approval and 5 business days for community input.
4. Merge the RFC; track implementation in a separate ticket.

You generally do **not** need an RFC for: bug fixes, internal refactors, additive UI events that the reducer already silently ignores, or new starter templates.

## Release workflow

Today the repo uses a hand-rolled bump-and-publish script. All six published packages are kept at the same version.

```bash
./scripts/bump-and-publish.sh [patch|minor|major]   # or
pnpm release        # alias for patch
pnpm release:dry    # bump only, no publish/commit
```

The script:

1. Runs `pnpm typecheck` and `pnpm build`.
2. Bumps all `packages/*/package.json` versions in sync (except deprecated `packages/openai/`).
3. Publishes in dependency order: `protocol` → `validate` → `react` → `nest` → `ai` → `next`.
4. Commits the bump and creates a `v<version>` git tag. Push tags manually.

We do **not** use Changesets today. Switching to Changesets is tracked separately; if the migration lands, this section will be updated.

## Adding a new package

1. Create `packages/<name>/` mirroring `packages/protocol/` (smallest existing layout).
2. `package.json`:
   - `"name": "@kibadist/agentui-<name>"`
   - `"version"`: match the current monorepo version (see `packages/protocol/package.json`).
   - `"type": "module"`, `"main"`/`"types"`/`"exports"` all pointing at `./dist/index.js` and `./dist/index.d.ts`.
   - `"publishConfig": { "access": "public" }`.
   - Workspace deps: `"@kibadist/agentui-<x>": "workspace:*"`.
   - Scripts: `build`, `typecheck`, `clean`, `prepublishOnly` — copy from an existing package.
3. `tsconfig.json` should `extends` from `tsconfig.base.json` and emit to `dist/`.
4. Add a `test/` directory if the package has runtime logic; vitest will pick it up.
5. Update `scripts/bump-and-publish.sh` so the new package gets versioned and published in the right dependency order.
6. Update `README.md` (the index), the relevant page under `docs/`, and `CHANGELOG.md`.
7. Run `pnpm install` from the repo root to refresh the lockfile.

## Adding a starter template under `examples/`

1. Create `examples/<name>/` modeled on `examples/next-app/`.
2. In `package.json`:
   - `"name": "@kibadist/agentui-example-<name>"`
   - `"private": true` (examples are workspace members but never published)
   - Use a distinct dev port to avoid clashes with the other examples.
   - Workspace-depend on the packages you exercise (`@kibadist/agentui-react`, `@kibadist/agentui-protocol`, `@kibadist/agentui-validate`).
3. `next.config.ts` must list the AgentUI packages under `transpilePackages`.
4. `tsconfig.json` should extend the next-app's settings (target ES2022, `moduleResolution: "bundler"`, jsx preserve).
5. Each example must `pnpm typecheck` cleanly. Test coverage is not required for examples.
6. Add a `README.md` covering: what the example demonstrates, how to run it (`pnpm --filter @kibadist/agentui-example-<name> dev`), and the file map.

## File and directory layout

```
packages/<name>/
  src/             TypeScript source (.ts / .tsx)
    index.ts       public surface — re-export everything consumers need
  test/            vitest specs (matched by root vitest.config.ts)
  dist/            tsc output (gitignored, npm-published)
  package.json
  tsconfig.json

examples/<name>/
  app/             Next.js App Router routes (where applicable)
  components/      example-local React components
  package.json
  next.config.ts
  tsconfig.json
  README.md
```

## Follow-ups not yet wired up

These were intentionally left out of the initial starter-template work so they can be tracked and reviewed separately:

- **Deploy to Vercel buttons** on each `examples/<name>/README.md`.
- **CodeSandbox / StackBlitz links** for in-browser previews of each example.
- **CI smoke-tests** that run each example's `pnpm typecheck && pnpm build` on every publish (no GitHub Actions exist in this repo yet).
- **Changesets migration** to replace the hand-rolled `scripts/bump-and-publish.sh` flow.

If you want to take any of these on, open an issue first so we can align on scope.

## Where to ask questions

Open an issue using the appropriate template under `.github/ISSUE_TEMPLATE/`. For protocol-level proposals, open an RFC PR (see `rfcs/README.md`) rather than an issue.
