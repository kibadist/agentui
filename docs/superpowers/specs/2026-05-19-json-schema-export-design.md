---
ticket: DET-156
title: JSON Schema export of the wire protocol
version_target: 0.9.x
date: 2026-05-19
---

# JSON Schema Export — Design Spec

## 1. Goal

Generate JSON Schema files from the existing Zod schemas so non-TypeScript consumers (Python, Go, OpenAPI tooling, doc generators) can validate the wire protocol without depending on Zod.

## 2. Where things live

The ticket says "Add a `pnpm schema:generate` script in `@kibadist/agentui-protocol`." But `@kibadist/agentui-protocol` is intentionally zero-dependency, pure-TypeScript types. The Zod schemas live in `@kibadist/agentui-validate`. So the generator and emitted files live in **`@kibadist/agentui-validate`**, alongside the schemas they're generated from. Same monorepo, same release cycle — semantically symmetric.

## 3. Generator

New file: `packages/validate/scripts/generate-schemas.ts` — invoked via `pnpm --filter @kibadist/agentui-validate schema:generate`, which uses `tsx` to run it.

```ts
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  uiNodeSchema,
  uiEventSchema,
  agentWireEventSchema,
  actionEventSchema,
} from "../src/schemas.js";

// Generate + write to packages/validate/schema/<name>.schema.json
```

Each call uses `target: "jsonSchema7"` and `name: <typename>` so each file has a deterministic `$schema` + `$ref`.

## 4. Emitted files

```
packages/validate/schema/
  ui-node.schema.json
  ui-event.schema.json
  agent-wire-event.schema.json
  action-event.schema.json
```

(Ticket called the third file `agent-state.schema.json` but the agent state is a client-side reducer struct, not a wire shape — what consumers actually need is `agent-wire-event.schema.json`, the full union including UI / tool / reasoning / optimistic / session / workflow events. Renamed for clarity.)

The files are committed to the repo so npm consumers get them via `npm install @kibadist/agentui-validate`.

## 5. Package config

- `packages/validate/package.json`:
  - `devDependencies`: `zod-to-json-schema` (^3.x), `tsx` (^4.x or use the version already in the repo if any).
  - `files`: add `"schema"` next to `"dist"`.
  - `scripts`:
    - `"schema:generate"`: `tsx scripts/generate-schemas.ts`
    - `"schema:check"`: `tsx scripts/generate-schemas.ts --check` (regenerates in-memory, diffs against committed files, fails on drift)

## 6. Drift check

The generator accepts `--check`. With the flag, it computes the JSON in-memory and compares (string-equal) against each on-disk file. Any mismatch → exits non-zero with a diff hint.

No CI workflow file is added (repo has no CI for tests yet — out of scope). The script exists for future CI wiring and for local pre-commit use.

## 7. Cross-check test

`packages/validate/test/json-schema.test.ts`:

For each of the 4 emitted schemas, load the JSON file at test time. Use `ajv` (test devDep) to compile the schema. For a representative corpus of valid + invalid events (from existing test fixtures or inline literals), assert:
- Ajv accepts ↔ `safeParseUIEvent` (or corresponding parser) accepts.
- Ajv rejects ↔ `safeParseUIEvent` rejects.

Cross-check at least: `ui.append` valid, `ui.append` missing required field, `tool.start` valid, `tool.start` missing required field. Optionally extend to all event types.

## 8. Acceptance criteria

- `pnpm --filter @kibadist/agentui-validate schema:generate` produces the 4 files.
- `pnpm --filter @kibadist/agentui-validate schema:check` exits 0 on clean state, non-zero if files drift.
- New cross-check test passes.
- `pnpm test` / `pnpm typecheck` / `pnpm build` all clean across monorepo.
- `packages/validate/schema/` is included in the published tarball (test via `npm pack --dry-run | grep schema`).
- README has a "JSON Schema export" subsection pointing non-TS consumers at `node_modules/@kibadist/agentui-validate/schema/*.json`.
- CHANGELOG records DET-156 under `Unreleased` / `Added`.

## 9. Out of scope

- Hosted versioned schema URL at `https://schemas.kibadist.io/agentui/...`.
- CI workflow file (no CI for tests exists yet in this repo).
- Auto-publishing schemas to a public registry / discovery endpoint.
- OpenAPI document generation.
