# JSON Schema Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate JSON Schema files from existing Zod schemas in `@kibadist/agentui-validate`. Ship in tarball. Provide a drift-check script. Cross-check via Ajv at test time.

**Architecture:** Generator script + 4 committed JSON files under `packages/validate/schema/`. Two npm scripts: `schema:generate` and `schema:check`. One vitest cross-check test.

**Tech Stack:** TypeScript, Zod, `zod-to-json-schema`, `tsx` for script execution, `ajv` for cross-checks.

---

### Task 1: Add deps + generator script

**Files:**
- Modify: `packages/validate/package.json`
- Create: `packages/validate/scripts/generate-schemas.ts`

- [ ] **Step 1: Add dependencies**

Edit `packages/validate/package.json` `devDependencies` to add:

```json
"ajv": "^8.17.0",
"tsx": "^4.19.0",
"zod-to-json-schema": "^3.24.1"
```

Add to `files`:

```json
"files": ["dist", "schema"]
```

Add to `scripts`:

```json
"schema:generate": "tsx scripts/generate-schemas.ts",
"schema:check": "tsx scripts/generate-schemas.ts --check"
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: clean install, lockfile updated.

- [ ] **Step 3: Write the generator**

Create `packages/validate/scripts/generate-schemas.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  uiNodeSchema,
  uiEventSchema,
  agentWireEventSchema,
  actionEventSchema,
} from "../src/schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, "..", "schema");

interface SchemaTarget {
  filename: string;
  name: string;
  schema: Parameters<typeof zodToJsonSchema>[0];
}

const targets: SchemaTarget[] = [
  { filename: "ui-node.schema.json", name: "UINode", schema: uiNodeSchema },
  { filename: "ui-event.schema.json", name: "UIEvent", schema: uiEventSchema },
  {
    filename: "agent-wire-event.schema.json",
    name: "AgentWireEvent",
    schema: agentWireEventSchema,
  },
  {
    filename: "action-event.schema.json",
    name: "ActionEvent",
    schema: actionEventSchema,
  },
];

const isCheck = process.argv.includes("--check");

function serialize(schema: SchemaTarget): string {
  const out = zodToJsonSchema(schema.schema, {
    name: schema.name,
    target: "jsonSchema7",
  });
  return JSON.stringify(out, null, 2) + "\n";
}

if (!isCheck && !existsSync(SCHEMA_DIR)) {
  mkdirSync(SCHEMA_DIR, { recursive: true });
}

let drifted: string[] = [];
for (const t of targets) {
  const text = serialize(t);
  const path = join(SCHEMA_DIR, t.filename);
  if (isCheck) {
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (existing !== text) drifted.push(t.filename);
  } else {
    writeFileSync(path, text, "utf8");
    console.log(`wrote ${t.filename} (${text.length} bytes)`);
  }
}

if (isCheck) {
  if (drifted.length > 0) {
    console.error(
      `Schema drift detected in: ${drifted.join(", ")}\n` +
        `Run \`pnpm --filter @kibadist/agentui-validate schema:generate\` to update.`,
    );
    process.exit(1);
  }
  console.log("Schemas up to date.");
}
```

- [ ] **Step 4: Verify import target**

The script does `from "../src/schemas.js"` — since `tsx` runs TS directly, the `.js` extension still works (`tsx` resolves it as `schemas.ts`). Confirm `packages/validate/src/schemas.ts` exports the four named schemas (`uiNodeSchema`, `uiEventSchema`, `agentWireEventSchema`, `actionEventSchema`). If `actionEventSchema` is not exported, add it to the `export` block in `schemas.ts`.

- [ ] **Step 5: Run generator**

Run: `pnpm --filter @kibadist/agentui-validate schema:generate`
Expected: writes 4 files to `packages/validate/schema/*.schema.json`.

- [ ] **Step 6: Inspect output**

Run: `ls packages/validate/schema/ && cat packages/validate/schema/ui-node.schema.json | head -30`
Expected: 4 files exist; the UI-node schema has `$schema: "http://json-schema.org/draft-07/schema#"` (or similar) and a `$ref` to `#/definitions/UINode`.

- [ ] **Step 7: Run drift check**

Run: `pnpm --filter @kibadist/agentui-validate schema:check`
Expected: exits 0 with "Schemas up to date."

- [ ] **Step 8: Commit**

```bash
git add packages/validate/package.json packages/validate/scripts packages/validate/schema pnpm-lock.yaml packages/validate/src/schemas.ts
git commit -m "feat(validate): JSON Schema generator + schema:generate / schema:check scripts (DET-156)"
```

---

### Task 2: Cross-check test (Ajv)

**Files:**
- Create: `packages/validate/test/json-schema.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { safeParseUIEvent, safeParseActionEvent, safeParseAgentEvent } from "../src/parse.js";

const SCHEMA_DIR = join(__dirname, "..", "schema");

function loadSchema(filename: string): object {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, filename), "utf8"));
}

const ajv = new Ajv({ allErrors: true, strict: false });

const base = {
  v: 1 as const,
  id: "e1",
  ts: "2026-05-19T00:00:00.000Z",
  sessionId: "s1",
};

describe("JSON Schema export — Ajv ↔ Zod cross-check", () => {
  it("ui-event.schema.json matches safeParseUIEvent for ui.append", () => {
    const schema = loadSchema("ui-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = {
      ...base,
      op: "ui.append",
      node: { key: "k1", type: "x.y", props: {} },
    };
    expect(validate(valid)).toBe(true);
    expect(safeParseUIEvent(valid).ok).toBe(true);
  });

  it("ui-event.schema.json rejects ui.append missing node (matches Zod)", () => {
    const schema = loadSchema("ui-event.schema.json");
    const validate = ajv.compile(schema);
    const invalid = { ...base, op: "ui.append" };
    expect(validate(invalid)).toBe(false);
    expect(safeParseUIEvent(invalid).ok).toBe(false);
  });

  it("agent-wire-event.schema.json accepts tool.start with all required fields", () => {
    const schema = loadSchema("agent-wire-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = {
      ...base,
      op: "tool.start",
      id: "call-1",
      name: "search_clients",
      args: { q: "Acme" },
    };
    expect(validate(valid)).toBe(true);
    expect(safeParseAgentEvent(valid).ok).toBe(true);
  });

  it("agent-wire-event.schema.json rejects tool.start missing name (matches Zod)", () => {
    const schema = loadSchema("agent-wire-event.schema.json");
    const validate = ajv.compile(schema);
    const invalid = { ...base, op: "tool.start", id: "call-1" };
    expect(validate(invalid)).toBe(false);
    expect(safeParseAgentEvent(invalid).ok).toBe(false);
  });

  it("action-event.schema.json accepts a valid action.submit", () => {
    const schema = loadSchema("action-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = {
      ...base,
      kind: "action",
      type: "action.submit",
      name: "purchase.confirm",
    };
    expect(validate(valid)).toBe(true);
    expect(safeParseActionEvent(valid).ok).toBe(true);
  });

  it("ui-node.schema.json accepts a nested UINode tree", () => {
    const schema = loadSchema("ui-node.schema.json");
    const validate = ajv.compile(schema);
    const node = {
      key: "root",
      type: "panel",
      props: {},
      children: [{ key: "child", type: "text", props: { value: "hi" } }],
    };
    expect(validate(node)).toBe(true);
  });
});
```

NOTE: `__dirname` requires CommonJS-style globals or compat shim. In ESM, derive it via `fileURLToPath(import.meta.url)`. Top of the file (replace the `__dirname` reference):

```ts
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
```

If Vitest's test environment is set up such that `__dirname` works directly, leave it. Otherwise use the shim. Verify by running the test.

ALSO: `safeParseUIEvent` may return `{ ok, value | error }` shape. Verify the shape by reading `packages/validate/src/parse.ts` and adjust assertions accordingly.

- [ ] **Step 2: Run test**

Run: `pnpm --filter @kibadist/agentui-validate test`
Expected: PASS (6 new tests).

- [ ] **Step 3: Commit**

```bash
git add packages/validate/test/json-schema.test.ts
git commit -m "test(validate): Ajv cross-check of generated JSON schemas (DET-156)"
```

---

### Task 3: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add README subsection**

Insert a new "JSON Schema export" subsection (place it after the validate / schemas-related docs, or near the Server companion docs). Format consistent with adjacent sections (4-backtick fences only where code blocks are nested):

```markdown
### JSON Schema export

Non-TypeScript consumers (Python, Go, OpenAPI tooling) can validate the wire protocol via JSON Schema files shipped in the `@kibadist/agentui-validate` tarball:

- `node_modules/@kibadist/agentui-validate/schema/ui-event.schema.json`
- `node_modules/@kibadist/agentui-validate/schema/ui-node.schema.json`
- `node_modules/@kibadist/agentui-validate/schema/agent-wire-event.schema.json`
- `node_modules/@kibadist/agentui-validate/schema/action-event.schema.json`

The files are regenerated from the Zod schemas via `pnpm schema:generate`. A `pnpm schema:check` script verifies the committed schemas match the Zod source; wire it into your CI to catch drift.
```

- [ ] **Step 2: Update CHANGELOG**

Under the existing `## [Unreleased]` → `### Added`, append:

```markdown
- JSON Schema export of the wire protocol — generated from Zod via `zod-to-json-schema` and shipped in the `@kibadist/agentui-validate` tarball. `pnpm schema:generate` / `pnpm schema:check` scripts. DET-156.
```

- [ ] **Step 3: Full monorepo verification**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: clean, no regressions.

- [ ] **Step 4: Verify tarball includes schema dir**

Run: `cd packages/validate && pnpm pack --dry-run 2>&1 | grep schema`
Expected: lists at least the four `.schema.json` files.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: JSON Schema export of the wire protocol (DET-156)"
```
