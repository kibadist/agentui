---
ticket: DET-146
title: CLI generator (npx @kibadist/agentui new-node)
version_target: 0.6.3
date: 2026-05-19
---

# CLI Generator — Design Spec

## 1. Goal

Lower time-to-first-render for new node types. A junior dev should be able to scaffold a typed, validated, tested, registry-wired component in one shell command:

```bash
npx @kibadist/agentui new-node QuoteCard
```

The output is a real component the dev only needs to fill in — props are typed, the Zod schema is in sync, the registry entry is inserted, and a vitest scaffold runs against the produced surface.

## 2. UX

### 2.1 Command line

```bash
npx @kibadist/agentui new-node <PascalCaseName> [--dry-run]
```

- `<PascalCaseName>` is required. The CLI converts it to kebab-case for filenames and registry keys (`QuoteCard` → `quote-card`).
- `--dry-run` prints the files that would be created and the registry diff, but writes nothing.
- No other flags in v0.6.3. (`--force` is intentionally out of scope; idempotency rule below takes priority.)

### 2.2 Help / version

- `npx @kibadist/agentui` (no args) prints help.
- `npx @kibadist/agentui --help` prints help.
- `npx @kibadist/agentui --version` prints the CLI's version (synced with all other packages).

### 2.3 Output

On success, the CLI prints (in this order):
1. List of created files (one per line, with `created` prefix)
2. Registry file path and the inserted entry line
3. Storybook-detected line if a story was generated (mentions which preset was detected)
4. Single next-step hint: `Run pnpm test` (or `npm test` — see §6.5 for detection)

On failure, exit code 1 with a single clear error message. No stack traces unless `DEBUG=agentui:*` is set.

## 3. Files Generated

For `new-node QuoteCard` with default config (`componentsDir: "./components"`):

| Path | Always? | Purpose |
|---|---|---|
| `./components/quote-card.tsx` | yes | Typed React component skeleton |
| `./components/quote-card.schema.ts` | yes | Zod schema + inferred `QuoteCardProps` type |
| `./components/quote-card.test.tsx` | yes | vitest scaffold using `@kibadist/agentui-react/testing` |
| `./components/quote-card.stories.tsx` | if Storybook detected | Storybook story |

The registry file is **modified** (not created): the CLI inserts the new entry into the existing registry. If no registry exists, the CLI fails with instructions.

### 3.1 Component template (`quote-card.tsx`)

```tsx
import type { QuoteCardProps } from "./quote-card.schema";

export function QuoteCard(props: QuoteCardProps) {
  return (
    <div>
      {/* TODO: render QuoteCard */}
      <pre>{JSON.stringify(props, null, 2)}</pre>
    </div>
  );
}
```

### 3.2 Schema template (`quote-card.schema.ts`)

```ts
import { z } from "zod";

export const quoteCardSchema = z.object({
  // TODO: define props. Use .describe() so the agent knows what each prop means.
  text: z.string().describe("the quote text"),
});

export type QuoteCardProps = z.infer<typeof quoteCardSchema>;
```

The single example prop (`text`) is intentional — it gives the dev a working schema to mutate, not an empty object that won't compile against the component.

### 3.3 Test template (`quote-card.test.tsx`)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuoteCard } from "./quote-card";
import { quoteCardSchema } from "./quote-card.schema";

describe("QuoteCard", () => {
  it("schema accepts valid props", () => {
    const result = quoteCardSchema.safeParse({ text: "hello" });
    expect(result.success).toBe(true);
  });

  it("renders without crashing", () => {
    render(<QuoteCard text="hello" />);
    expect(screen.getByText(/hello/)).toBeTruthy();
  });
});
```

### 3.4 Story template (`quote-card.stories.tsx`)

Only generated if Storybook is detected (see §6.4). Uses CSF3 syntax — works for `@storybook/react` and `@storybook/nextjs`:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { QuoteCard } from "./quote-card";

const meta: Meta<typeof QuoteCard> = {
  title: "Agent/QuoteCard",
  component: QuoteCard,
};
export default meta;

export const Default: StoryObj<typeof QuoteCard> = {
  args: { text: "hello" },
};
```

## 4. Registry Insertion

### 4.1 Marker comments (required)

The CLI requires two marker comments inside the `createRegistry({ ... })` call:

```ts
// agentui:registry-imports-start
// agentui:registry-imports-end

export const registry = createRegistry({
  // agentui:registry-entries-start
  // agentui:registry-entries-end
});
```

Imports are inserted **after** `agentui:registry-imports-start` (alphabetical by component path). Entry keys are inserted **after** `agentui:registry-entries-start` (alphabetical by key).

### 4.2 Bootstrap behavior

If the configured registry file exists but lacks the markers, the CLI fails with:

```
Registry file ./components/registry.ts has no agentui markers.

Add these markers to enable auto-insertion:

  // agentui:registry-imports-start
  // agentui:registry-imports-end

  ...createRegistry({
    // agentui:registry-entries-start
    // agentui:registry-entries-end
  });

Then re-run.
```

The CLI does NOT attempt to add markers automatically. Marker placement is a one-time host-project setup; we keep the CLI dumb.

If the registry file does not exist at the configured path, the CLI fails with: `Registry not found at <path>. Set "registry" in agentui.config.json or create the file.`

### 4.3 Insertion mechanics

- Imports use the absolute path from the registry file to the component file (relative, e.g. `./quote-card`).
- The CLI generates two lines:
  ```ts
  import { QuoteCard } from "./quote-card";
  import { quoteCardSchema } from "./quote-card.schema";
  ```
- Entry line:
  ```ts
  "quote-card": { component: QuoteCard, propsSchema: quoteCardSchema },
  ```
- Insertion is **string-level** (not AST). Match the marker line literally; insert the new lines immediately after it; preserve existing content between markers. No reformatting.

## 5. Configuration

### 5.1 File location

`agentui.config.json` at the project root (the directory where `npx` is invoked, i.e. `process.cwd()`).

### 5.2 Schema

```json
{
  "$schema": "https://kibadist.github.io/agentui/config.schema.json",
  "registry": "./components/registry.ts",
  "componentsDir": "./components"
}
```

All fields optional; defaults shown. The `$schema` URL is aspirational — not hosted in v0.6.3, but accepted in the file so IDE warnings don't appear.

### 5.3 Inference when no config exists

If `agentui.config.json` is missing, the CLI uses the defaults above without erroring. This is the common case for a fresh setup: the host project followed the example layout.

### 5.4 Validation

The config is validated with a Zod schema inside the CLI. Unknown keys → warning (not error), so future fields don't break older CLIs.

## 6. Detection and Edge Cases

### 6.1 Name validation

- Input must match `/^[A-Z][A-Za-z0-9]*$/` (PascalCase, starts with capital, ASCII only).
- Reject names ≤ 1 character (`Q` is invalid).
- Reject reserved words (a small allow-list check against JS reserved words).
- On rejection, print a clear example: `Component names must be PascalCase, e.g. QuoteCard.`

### 6.2 kebab-case conversion

`QuoteCard` → `quote-card`. Algorithm: insert `-` before every capital letter that follows a lowercase letter or digit, then lowercase. `OAuthButton` → `o-auth-button` (good enough; we don't try to detect acronyms).

### 6.3 Idempotency

If ANY of the target files (component, schema, test, story-if-storybook) already exists, the CLI fails before writing anything:

```
Cannot create QuoteCard — these files already exist:
  ./components/quote-card.tsx
  ./components/quote-card.schema.ts

Delete them and re-run, or pick a different name.
```

Existing registry entries also fail the run — checked by scanning between the entry markers for `"quote-card":` substring.

### 6.4 Storybook detection

Read host `package.json` and inspect `dependencies` and `devDependencies`. Story is generated if EITHER of these is present:

- `@storybook/react`
- `@storybook/nextjs`

The story template is identical for both presets (CSF3 from `@storybook/react` works in both). The success message names which preset triggered detection.

### 6.5 Package manager hint detection

For the post-success hint (`Run pnpm test` vs `npm test`), check the host project root for these files in order:
1. `pnpm-lock.yaml` → `pnpm test`
2. `yarn.lock` → `yarn test`
3. `package-lock.json` → `npm test`
4. None → `npm test`

This is cosmetic only; we never run a package manager command ourselves.

## 7. Package Layout

New workspace package:

```
packages/cli/
├── package.json          name: "@kibadist/agentui"
├── tsconfig.json
├── src/
│   ├── cli.ts            shebang entry point, parses argv, dispatches
│   ├── commands/
│   │   ├── new-node.ts   the only command in v0.6.3
│   │   └── help.ts
│   ├── core/
│   │   ├── config.ts     load + validate agentui.config.json
│   │   ├── name.ts       validation + kebab conversion
│   │   ├── detect.ts     Storybook + package manager detection
│   │   ├── registry-edit.ts  marker-based insertion
│   │   └── templates.ts  the four file templates
│   └── index.ts          re-exports for testing only
└── test/
    ├── name.test.ts
    ├── registry-edit.test.ts
    ├── detect.test.ts
    ├── new-node.test.ts        snapshot + idempotency
    └── fixtures/
        └── ...        sample host projects for end-to-end tests
```

### 7.1 package.json

```json
{
  "name": "@kibadist/agentui",
  "version": "0.0.0",
  "description": "CLI for scaffolding AgentUI components",
  "type": "module",
  "bin": { "agentui": "./dist/cli.js" },
  "exports": { ".": { "import": "./dist/index.js" } },
  "files": ["dist"],
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

- Zero runtime deps except `zod` (already a peer dep of the rest of the project; safe and tiny).
- Initial `0.0.0` is a placeholder; `scripts/bump-and-publish.sh` overwrites every package's version to the new sync'd value (`0.6.3` on first publish).
- The `bin` is the package's only consumer-facing surface. The `exports` block exists only so the test suite can import internals; consumers should not import this package.

### 7.2 Built output

The compiled `dist/cli.js` MUST begin with `#!/usr/bin/env node`. We add the shebang via a one-line post-build step in the package's `prepublishOnly` script.

### 7.3 Argv parsing

No CLI framework. A 20-line argv parser in `cli.ts` handles:
- `--help` / `-h` / no args → print help, exit 0
- `--version` / `-v` → print version, exit 0
- `new-node <Name>` → call command
- `--dry-run` flag passed through to `new-node`
- Anything else → print "unknown command" + help, exit 1

## 8. Testing

### 8.1 Unit tests (vitest, jsdom)

- `name.test.ts`: PascalCase validation accepts/rejects expected inputs; kebab conversion handles edge cases (single word, multi-word, with digits).
- `registry-edit.test.ts`: 
  - inserts a new import and entry between markers (golden output)
  - preserves existing entries
  - inserts entries in alphabetical order
  - fails clearly when markers are missing
  - fails clearly when entry key already exists
- `detect.test.ts`: Storybook detection returns true for `@storybook/react`, true for `@storybook/nextjs`, false for neither, false for no `package.json`. Package manager hint detection in order of preference.

### 8.2 End-to-end snapshot test (`new-node.test.ts`)

A temp dir is created with a known fixture (component dir + registry with markers + `package.json`). The CLI's `new-node` command is invoked programmatically (not via `child_process` — we expose `runNewNode(args, cwd)` for testability). Assertions:

- All four files exist (or three, when fixture has no Storybook)
- Each generated file matches a snapshot byte-for-byte
- Registry file diff matches a snapshot
- Re-running the command fails with the idempotency error AND leaves files untouched (mtime check)

### 8.3 What we deliberately do NOT test

- Actual `child_process` invocation of the bin (covered by snapshot of the templates + parsing tests).
- Running `npx @kibadist/agentui` against a fresh registry (manual smoke test before publish).

## 9. Release Mechanics

### 9.1 Publish script update

`scripts/bump-and-publish.sh` PACKAGES array gets `packages/cli` appended. Position: last (no other package depends on it).

### 9.2 Version sync

`@kibadist/agentui` joins the synced version club at the next bump. Initial version in the package.json is `0.0.0`; the bump script sets it to the next patch (`0.6.3`).

### 9.3 README

Add a "CLI" section after the LLM adapters and DevTools subsections, with a single example invocation and a one-line config snippet.

### 9.4 CHANGELOG

`## 0.6.3` block listing:
- Added: `@kibadist/agentui` CLI package with `new-node` command
- Notes: subsequent commands (e.g. `init`, `add-registry-markers`) deferred to a later minor

## 10. Out of Scope (v0.6.3)

- `--force` overwrite flag
- `init` command to scaffold an initial config + registry markers
- TypeScript AST-based registry editing (markers are sufficient)
- Multiple component generation in one call
- Custom template overrides
- Telemetry / anonymous usage stats

## 11. Open Questions

None. Defaults stand.

## 12. Acceptance Criteria

A reviewer should be able to verify, from this spec alone:
- Run `npx @kibadist/agentui new-node QuoteCard` in `examples/next-app/` after a one-time marker addition to `components/registry.ts`.
- Four files appear: `quote-card.tsx`, `quote-card.schema.ts`, `quote-card.test.tsx`, `quote-card.stories.tsx` (Storybook is in `package.json` for this example only if added — otherwise three files).
- `pnpm test` in the example passes (the new component's scaffolded tests pass).
- Re-running the command fails clearly without overwriting.
- `pnpm typecheck` in the example passes.
