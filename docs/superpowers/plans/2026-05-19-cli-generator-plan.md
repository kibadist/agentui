# CLI Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@kibadist/agentui` CLI shim package whose `new-node <Name>` command scaffolds a typed component + Zod schema + vitest scaffold (+ optional Storybook story) and inserts a registry entry via marker comments. Targets v0.6.3.

**Architecture:** New workspace package at `packages/cli/` published as `@kibadist/agentui`. CLI has zero CLI-framework dep; uses a small argv parser. Templates are inline TS strings. Registry insertion is string-level using marker comments. Storybook + package-manager detection from host `package.json` / lockfiles.

**Tech Stack:** TypeScript (NodeNext ESM), Node ≥18, Zod for config validation, vitest+jsdom for tests.

**Reference spec:** `docs/superpowers/specs/2026-05-19-cli-generator-design.md`

---

## File Structure

The new package lives under `packages/cli/`:

```
packages/cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                  # bin entry: shebang, argv parse, command dispatch
│   ├── index.ts                # test-only barrel exporting runNewNode + internals
│   ├── commands/
│   │   ├── help.ts             # printHelp() — text only
│   │   └── new-node.ts         # runNewNode(args, cwd) — orchestrates everything
│   └── core/
│       ├── name.ts             # validateName(), toKebab()
│       ├── config.ts           # loadConfig(cwd): { registry, componentsDir }
│       ├── detect.ts           # detectStorybook(cwd), detectPackageManager(cwd)
│       ├── registry-edit.ts    # insertRegistryEntry({...}) → string transform
│       └── templates.ts        # render*() functions for the four files
└── test/
    ├── name.test.ts
    ├── config.test.ts
    ├── detect.test.ts
    ├── registry-edit.test.ts
    └── new-node.test.ts        # E2E in tmp dir
```

Outside the new package:
- `scripts/bump-and-publish.sh` — add `packages/cli` to `PACKAGES`
- `CHANGELOG.md` — add `## 0.6.3` block
- `README.md` — add "CLI generator" subsection
- `pnpm-workspace.yaml` — already covers `packages/*`, no change needed

Each `core/` file has one responsibility and exposes pure functions. `commands/new-node.ts` glues them. This keeps every file small enough to read in one pass.

---

## Task 0: Scaffold the package skeleton

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/cli.ts`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/help.ts`

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "@kibadist/agentui",
  "version": "0.0.0",
  "description": "CLI for scaffolding AgentUI components",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/kibadist/agentui.git",
    "directory": "packages/cli"
  },
  "homepage": "https://github.com/kibadist/agentui#readme",
  "publishConfig": {
    "access": "public"
  },
  "type": "module",
  "sideEffects": false,
  "bin": {
    "agentui": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "prepublishOnly": "pnpm run build",
    "build": "tsc && node -e \"const fs=require('fs');const p='dist/cli.js';const s=fs.readFileSync(p,'utf8');if(!s.startsWith('#!'))fs.writeFileSync(p,'#!/usr/bin/env node\\n'+s);fs.chmodSync(p,0o755);\"",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

Note: `types: ["node"]` is required because the CLI uses `process`, `fs`, `path`. Install `@types/node` next.

- [ ] **Step 3: Add `@types/node` to the package as a devDependency, then install**

```bash
cd packages/cli && pnpm add -D @types/node@^20 && cd ../..
```

Expected: `pnpm-lock.yaml` updates; `@types/node` appears in `packages/cli/package.json` under `devDependencies`.

- [ ] **Step 4: Create `packages/cli/src/commands/help.ts`**

```ts
export const HELP_TEXT = `agentui — scaffold AgentUI components

Usage:
  agentui new-node <PascalCaseName> [--dry-run]
  agentui --help
  agentui --version

Commands:
  new-node    Scaffold a new component (tsx + zod schema + test + registry entry)

Options:
  --dry-run   Print what would happen without writing files
  --help, -h  Show this help
  --version,  Print version

Config (optional, project root):
  agentui.config.json
    {
      "registry": "./components/registry.ts",
      "componentsDir": "./components"
    }
`;

export function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}
```

- [ ] **Step 5: Create `packages/cli/src/cli.ts` (minimal — only help/version/unknown for now)**

```ts
import { printHelp } from "./commands/help.js";

const VERSION = "0.0.0";

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  process.stderr.write(`Unknown command: ${args[0]}\n\n`);
  printHelp();
  return 1;
}

process.exit(main(process.argv));
```

- [ ] **Step 6: Create `packages/cli/src/index.ts` (test barrel — empty for now)**

```ts
export {};
```

- [ ] **Step 7: Verify build**

Run from repo root:

```bash
pnpm --filter @kibadist/agentui build
```

Expected: no errors. `packages/cli/dist/cli.js` exists, starts with `#!/usr/bin/env node`, is executable (`ls -l` shows `x` bits).

- [ ] **Step 8: Smoke-test the bin**

```bash
node packages/cli/dist/cli.js --help
node packages/cli/dist/cli.js --version
node packages/cli/dist/cli.js bogus; echo "exit=$?"
```

Expected: help printed; `0.0.0` printed; `Unknown command: bogus\n\n<help>` printed and `exit=1`.

- [ ] **Step 9: Commit**

```bash
git add packages/cli pnpm-lock.yaml
git commit -m "feat(cli): scaffold @kibadist/agentui package with help/version"
```

---

## Task 1: Name validation and kebab-case conversion

**Files:**
- Create: `packages/cli/src/core/name.ts`
- Create: `packages/cli/test/name.test.ts`

- [ ] **Step 1: Write failing tests in `packages/cli/test/name.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { validateName, toKebab } from "../src/core/name.js";

describe("validateName", () => {
  it("accepts PascalCase", () => {
    expect(validateName("QuoteCard").ok).toBe(true);
    expect(validateName("ABCard").ok).toBe(true);
    expect(validateName("Card1").ok).toBe(true);
  });

  it("rejects single letter", () => {
    const r = validateName("Q");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PascalCase/);
  });

  it("rejects lowercase start", () => {
    expect(validateName("quoteCard").ok).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateName("").ok).toBe(false);
  });

  it("rejects non-ASCII or punctuation", () => {
    expect(validateName("Quote-Card").ok).toBe(false);
    expect(validateName("QuôteCard").ok).toBe(false);
    expect(validateName("Quote Card").ok).toBe(false);
  });

  it("rejects JS reserved words", () => {
    expect(validateName("Class").ok).toBe(false);
    expect(validateName("Return").ok).toBe(false);
  });
});

describe("toKebab", () => {
  it("single word", () => {
    expect(toKebab("Card")).toBe("card");
  });
  it("two words", () => {
    expect(toKebab("QuoteCard")).toBe("quote-card");
  });
  it("acronym prefix", () => {
    expect(toKebab("OAuthButton")).toBe("o-auth-button");
  });
  it("trailing digit", () => {
    expect(toKebab("Card2")).toBe("card2");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL ("Cannot find module")**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/name.test.ts
```

Expected: FAIL with module resolution error.

- [ ] **Step 3: Implement `packages/cli/src/core/name.ts`**

```ts
const RESERVED = new Set([
  "Class", "Return", "Function", "Const", "Let", "Var", "Import", "Export",
  "Default", "If", "Else", "For", "While", "Do", "Switch", "Case", "Break",
  "Continue", "New", "This", "Super", "Typeof", "Instanceof", "Void", "Delete",
  "Throw", "Try", "Catch", "Finally", "Yield", "Async", "Await", "Static",
  "Public", "Private", "Protected", "Interface", "Implements", "Enum",
]);

export type ValidateResult = { ok: true } | { ok: false; error: string };

export function validateName(name: string): ValidateResult {
  if (!name || name.length < 2) {
    return { ok: false, error: "Component names must be PascalCase, e.g. QuoteCard." };
  }
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    return { ok: false, error: "Component names must be PascalCase, e.g. QuoteCard." };
  }
  if (RESERVED.has(name)) {
    return { ok: false, error: `"${name}" is a reserved word. Pick a different name.` };
  }
  return { ok: true };
}

export function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/name.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/core/name.ts packages/cli/test/name.test.ts
git commit -m "feat(cli): name validation and kebab-case conversion"
```

---

## Task 2: Config loader

**Files:**
- Create: `packages/cli/src/core/config.ts`
- Create: `packages/cli/test/config.test.ts`

- [ ] **Step 1: Write failing tests in `packages/cli/test/config.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/core/config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentui-cfg-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when no config file", () => {
    const cfg = loadConfig(tmp);
    expect(cfg.registry).toBe("./components/registry.ts");
    expect(cfg.componentsDir).toBe("./components");
  });

  it("reads partial overrides", () => {
    fs.writeFileSync(
      path.join(tmp, "agentui.config.json"),
      JSON.stringify({ componentsDir: "./src/components" }),
    );
    const cfg = loadConfig(tmp);
    expect(cfg.componentsDir).toBe("./src/components");
    expect(cfg.registry).toBe("./components/registry.ts");
  });

  it("warns on unknown keys but does not throw", () => {
    fs.writeFileSync(
      path.join(tmp, "agentui.config.json"),
      JSON.stringify({ componentsDir: "./x", futureKey: true }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = loadConfig(tmp);
    expect(cfg.componentsDir).toBe("./x");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("throws on invalid JSON", () => {
    fs.writeFileSync(path.join(tmp, "agentui.config.json"), "{ not json");
    expect(() => loadConfig(tmp)).toThrow(/agentui\.config\.json/);
  });

  it("throws on wrong types", () => {
    fs.writeFileSync(
      path.join(tmp, "agentui.config.json"),
      JSON.stringify({ componentsDir: 123 }),
    );
    expect(() => loadConfig(tmp)).toThrow();
  });
});
```

Add the `vi` import at the top:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/config.test.ts
```

- [ ] **Step 3: Implement `packages/cli/src/core/config.ts`**

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    registry: z.string().default("./components/registry.ts"),
    componentsDir: z.string().default("./components"),
  })
  .strict()
  .or(z.object({}).passthrough());

export interface AgentuiConfig {
  registry: string;
  componentsDir: string;
}

const DEFAULTS: AgentuiConfig = {
  registry: "./components/registry.ts",
  componentsDir: "./components",
};

const KNOWN_KEYS = new Set(["$schema", "registry", "componentsDir"]);

export function loadConfig(cwd: string): AgentuiConfig {
  const file = path.join(cwd, "agentui.config.json");
  if (!fs.existsSync(file)) return { ...DEFAULTS };

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse agentui.config.json: ${(err as Error).message}`);
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("agentui.config.json must be a JSON object.");
  }

  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      console.warn(`agentui.config.json: unknown key "${key}" (ignored)`);
    }
  }

  const FieldSchema = z.object({
    registry: z.string().optional(),
    componentsDir: z.string().optional(),
  });
  const parsed = FieldSchema.parse(obj);

  return {
    registry: parsed.registry ?? DEFAULTS.registry,
    componentsDir: parsed.componentsDir ?? DEFAULTS.componentsDir,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/config.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/core/config.ts packages/cli/test/config.test.ts
git commit -m "feat(cli): config loader with defaults and zod validation"
```

---

## Task 3: Storybook + package-manager detection

**Files:**
- Create: `packages/cli/src/core/detect.ts`
- Create: `packages/cli/test/detect.test.ts`

- [ ] **Step 1: Write failing tests in `packages/cli/test/detect.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectStorybook, detectPackageManager } from "../src/core/detect.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentui-detect-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writePkg(deps: object) {
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(deps));
}

describe("detectStorybook", () => {
  it("returns null when no package.json", () => {
    expect(detectStorybook(tmp)).toBeNull();
  });
  it("detects @storybook/react in dependencies", () => {
    writePkg({ dependencies: { "@storybook/react": "^8" } });
    expect(detectStorybook(tmp)).toBe("@storybook/react");
  });
  it("detects @storybook/nextjs in devDependencies", () => {
    writePkg({ devDependencies: { "@storybook/nextjs": "^8" } });
    expect(detectStorybook(tmp)).toBe("@storybook/nextjs");
  });
  it("prefers @storybook/nextjs when both present", () => {
    writePkg({
      devDependencies: { "@storybook/react": "^8", "@storybook/nextjs": "^8" },
    });
    expect(detectStorybook(tmp)).toBe("@storybook/nextjs");
  });
  it("returns null when neither present", () => {
    writePkg({ dependencies: { react: "^19" } });
    expect(detectStorybook(tmp)).toBeNull();
  });
});

describe("detectPackageManager", () => {
  it("detects pnpm", () => {
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(tmp)).toBe("pnpm");
  });
  it("detects yarn", () => {
    fs.writeFileSync(path.join(tmp, "yarn.lock"), "");
    expect(detectPackageManager(tmp)).toBe("yarn");
  });
  it("detects npm", () => {
    fs.writeFileSync(path.join(tmp, "package-lock.json"), "");
    expect(detectPackageManager(tmp)).toBe("npm");
  });
  it("prefers pnpm > yarn > npm", () => {
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");
    fs.writeFileSync(path.join(tmp, "yarn.lock"), "");
    fs.writeFileSync(path.join(tmp, "package-lock.json"), "");
    expect(detectPackageManager(tmp)).toBe("pnpm");
  });
  it("falls back to npm when no lockfile", () => {
    expect(detectPackageManager(tmp)).toBe("npm");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/detect.test.ts
```

- [ ] **Step 3: Implement `packages/cli/src/core/detect.ts`**

```ts
import * as fs from "node:fs";
import * as path from "node:path";

export type StorybookPreset = "@storybook/react" | "@storybook/nextjs";
export type PackageManager = "pnpm" | "yarn" | "npm";

export function detectStorybook(cwd: string): StorybookPreset | null {
  const file = path.join(cwd, "package.json");
  if (!fs.existsSync(file)) return null;
  let pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  try {
    pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if ("@storybook/nextjs" in all) return "@storybook/nextjs";
  if ("@storybook/react" in all) return "@storybook/react";
  return null;
}

export function detectPackageManager(cwd: string): PackageManager {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/detect.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/core/detect.ts packages/cli/test/detect.test.ts
git commit -m "feat(cli): Storybook preset and package manager detection"
```

---

## Task 4: Registry insertion via marker comments

**Files:**
- Create: `packages/cli/src/core/registry-edit.ts`
- Create: `packages/cli/test/registry-edit.test.ts`

- [ ] **Step 1: Write failing tests in `packages/cli/test/registry-edit.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { insertRegistryEntry, hasMarkers, hasEntryKey } from "../src/core/registry-edit.js";

const BASE = `import { createRegistry } from "@kibadist/agentui-react";
// agentui:registry-imports-start
// agentui:registry-imports-end

export const registry = createRegistry({
  // agentui:registry-entries-start
  // agentui:registry-entries-end
});
`;

describe("hasMarkers", () => {
  it("true when all four markers present", () => {
    expect(hasMarkers(BASE)).toBe(true);
  });
  it("false when imports markers missing", () => {
    expect(hasMarkers(BASE.replace(/agentui:registry-imports-(start|end)\n/g, ""))).toBe(false);
  });
  it("false when entries markers missing", () => {
    expect(hasMarkers(BASE.replace(/agentui:registry-entries-(start|end)\n/g, ""))).toBe(false);
  });
});

describe("hasEntryKey", () => {
  it("false when key not present", () => {
    expect(hasEntryKey(BASE, "quote-card")).toBe(false);
  });
  it("true when key already present", () => {
    const src = BASE.replace(
      "// agentui:registry-entries-start",
      `// agentui:registry-entries-start\n  "quote-card": { component: QuoteCard, propsSchema: quoteCardSchema },`,
    );
    expect(hasEntryKey(src, "quote-card")).toBe(true);
  });
});

describe("insertRegistryEntry", () => {
  it("inserts import and entry between markers", () => {
    const out = insertRegistryEntry(BASE, {
      kebabKey: "quote-card",
      pascalName: "QuoteCard",
      schemaConst: "quoteCardSchema",
      componentImportPath: "./quote-card",
      schemaImportPath: "./quote-card.schema",
    });
    expect(out).toContain(`import { QuoteCard } from "./quote-card";`);
    expect(out).toContain(`import { quoteCardSchema } from "./quote-card.schema";`);
    expect(out).toContain(`"quote-card": { component: QuoteCard, propsSchema: quoteCardSchema },`);
  });

  it("preserves existing entries", () => {
    const withExisting = BASE.replace(
      "// agentui:registry-entries-start",
      `// agentui:registry-entries-start\n  "info-card": { component: InfoCard, propsSchema: infoCardSchema },`,
    ).replace(
      "// agentui:registry-imports-start",
      `// agentui:registry-imports-start\nimport { InfoCard } from "./info-card";\nimport { infoCardSchema } from "./info-card.schema";`,
    );

    const out = insertRegistryEntry(withExisting, {
      kebabKey: "quote-card",
      pascalName: "QuoteCard",
      schemaConst: "quoteCardSchema",
      componentImportPath: "./quote-card",
      schemaImportPath: "./quote-card.schema",
    });

    expect(out).toContain(`"info-card":`);
    expect(out).toContain(`"quote-card":`);
    expect(out).toContain(`InfoCard`);
    expect(out).toContain(`QuoteCard`);
  });

  it("places new entry alphabetically after existing entry with earlier key", () => {
    const withExisting = BASE.replace(
      "// agentui:registry-entries-start",
      `// agentui:registry-entries-start\n  "action-card": { component: ActionCard, propsSchema: actionCardSchema },`,
    );

    const out = insertRegistryEntry(withExisting, {
      kebabKey: "quote-card",
      pascalName: "QuoteCard",
      schemaConst: "quoteCardSchema",
      componentImportPath: "./quote-card",
      schemaImportPath: "./quote-card.schema",
    });

    // "action-card" appears before "quote-card"
    expect(out.indexOf(`"action-card"`)).toBeLessThan(out.indexOf(`"quote-card"`));
  });

  it("throws when markers missing", () => {
    expect(() => insertRegistryEntry("// no markers", {
      kebabKey: "quote-card",
      pascalName: "QuoteCard",
      schemaConst: "quoteCardSchema",
      componentImportPath: "./quote-card",
      schemaImportPath: "./quote-card.schema",
    })).toThrow(/markers/i);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/registry-edit.test.ts
```

- [ ] **Step 3: Implement `packages/cli/src/core/registry-edit.ts`**

```ts
const IMPORTS_START = "// agentui:registry-imports-start";
const IMPORTS_END = "// agentui:registry-imports-end";
const ENTRIES_START = "// agentui:registry-entries-start";
const ENTRIES_END = "// agentui:registry-entries-end";

export interface InsertArgs {
  kebabKey: string;
  pascalName: string;
  schemaConst: string;
  componentImportPath: string;
  schemaImportPath: string;
}

export function hasMarkers(src: string): boolean {
  return (
    src.includes(IMPORTS_START) &&
    src.includes(IMPORTS_END) &&
    src.includes(ENTRIES_START) &&
    src.includes(ENTRIES_END)
  );
}

export function hasEntryKey(src: string, kebabKey: string): boolean {
  const entriesBlock = sliceBetween(src, ENTRIES_START, ENTRIES_END);
  if (entriesBlock === null) return false;
  return new RegExp(`["']${escapeRegex(kebabKey)}["']\\s*:`).test(entriesBlock);
}

export function insertRegistryEntry(src: string, args: InsertArgs): string {
  if (!hasMarkers(src)) {
    throw new Error(
      "Registry markers not found. Add agentui:registry-imports-{start,end} and agentui:registry-entries-{start,end} marker comments.",
    );
  }
  const importLines = [
    `import { ${args.pascalName} } from "${args.componentImportPath}";`,
    `import { ${args.schemaConst} } from "${args.schemaImportPath}";`,
  ];
  const entryLine = `  "${args.kebabKey}": { component: ${args.pascalName}, propsSchema: ${args.schemaConst} },`;

  let out = insertSortedBetween(src, IMPORTS_START, IMPORTS_END, importLines, (line) => line);
  out = insertSortedBetween(out, ENTRIES_START, ENTRIES_END, [entryLine], (line) => {
    const m = line.match(/"([^"]+)"\s*:/);
    return m ? m[1] : line;
  });
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sliceBetween(src: string, start: string, end: string): string | null {
  const i = src.indexOf(start);
  const j = src.indexOf(end);
  if (i === -1 || j === -1 || j < i) return null;
  return src.slice(i + start.length, j);
}

function insertSortedBetween(
  src: string,
  start: string,
  end: string,
  newLines: string[],
  keyFn: (line: string) => string,
): string {
  const i = src.indexOf(start);
  const j = src.indexOf(end);
  if (i === -1 || j === -1) return src;

  const blockStart = i + start.length;
  const blockEnd = j;
  const block = src.slice(blockStart, blockEnd);

  const existing = block.split("\n").filter((l) => l.trim() !== "");
  const combined = [...existing, ...newLines];
  combined.sort((a, b) => keyFn(a).localeCompare(keyFn(b)));

  const rebuilt = "\n" + combined.join("\n") + "\n";
  return src.slice(0, blockStart) + rebuilt + src.slice(blockEnd);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/registry-edit.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/core/registry-edit.ts packages/cli/test/registry-edit.test.ts
git commit -m "feat(cli): marker-based registry insertion with alphabetical ordering"
```

---

## Task 5: Templates

**Files:**
- Create: `packages/cli/src/core/templates.ts`
- Create: `packages/cli/test/templates.test.ts`

- [ ] **Step 1: Write failing tests in `packages/cli/test/templates.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { renderComponent, renderSchema, renderTest, renderStory } from "../src/core/templates.js";

const ARGS = { pascalName: "QuoteCard", kebabName: "quote-card", schemaConst: "quoteCardSchema" };

describe("templates", () => {
  it("component imports from schema and renders props", () => {
    const out = renderComponent(ARGS);
    expect(out).toContain(`import type { QuoteCardProps } from "./quote-card.schema";`);
    expect(out).toContain(`export function QuoteCard(props: QuoteCardProps)`);
  });

  it("schema exports zod object and inferred type", () => {
    const out = renderSchema(ARGS);
    expect(out).toContain(`export const quoteCardSchema = z.object({`);
    expect(out).toContain(`export type QuoteCardProps = z.infer<typeof quoteCardSchema>;`);
    expect(out).toContain(`.describe(`);
  });

  it("test imports both component and schema", () => {
    const out = renderTest(ARGS);
    expect(out).toContain(`import { QuoteCard } from "./quote-card";`);
    expect(out).toContain(`import { quoteCardSchema } from "./quote-card.schema";`);
    expect(out).toContain(`safeParse`);
  });

  it("story uses CSF3 and @storybook/react types", () => {
    const out = renderStory(ARGS);
    expect(out).toContain(`import type { Meta, StoryObj } from "@storybook/react";`);
    expect(out).toContain(`title: "Agent/QuoteCard"`);
    expect(out).toContain(`export const Default`);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/templates.test.ts
```

- [ ] **Step 3: Implement `packages/cli/src/core/templates.ts`**

```ts
export interface TemplateArgs {
  pascalName: string;
  kebabName: string;
  schemaConst: string;
}

export function renderComponent({ pascalName, kebabName }: TemplateArgs): string {
  return `import type { ${pascalName}Props } from "./${kebabName}.schema";

export function ${pascalName}(props: ${pascalName}Props) {
  return (
    <div>
      {/* TODO: render ${pascalName} */}
      <pre>{JSON.stringify(props, null, 2)}</pre>
    </div>
  );
}
`;
}

export function renderSchema({ pascalName, schemaConst }: TemplateArgs): string {
  return `import { z } from "zod";

export const ${schemaConst} = z.object({
  // TODO: define props. Use .describe() so the agent knows what each prop means.
  text: z.string().describe("the quote text"),
});

export type ${pascalName}Props = z.infer<typeof ${schemaConst}>;
`;
}

export function renderTest({ pascalName, kebabName, schemaConst }: TemplateArgs): string {
  return `import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ${pascalName} } from "./${kebabName}";
import { ${schemaConst} } from "./${kebabName}.schema";

describe("${pascalName}", () => {
  it("schema accepts valid props", () => {
    const result = ${schemaConst}.safeParse({ text: "hello" });
    expect(result.success).toBe(true);
  });

  it("renders without crashing", () => {
    render(<${pascalName} text="hello" />);
    expect(screen.getByText(/hello/)).toBeTruthy();
  });
});
`;
}

export function renderStory({ pascalName, kebabName }: TemplateArgs): string {
  return `import type { Meta, StoryObj } from "@storybook/react";
import { ${pascalName} } from "./${kebabName}";

const meta: Meta<typeof ${pascalName}> = {
  title: "Agent/${pascalName}",
  component: ${pascalName},
};
export default meta;

export const Default: StoryObj<typeof ${pascalName}> = {
  args: { text: "hello" },
};
`;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/templates.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/core/templates.ts packages/cli/test/templates.test.ts
git commit -m "feat(cli): file templates for component, schema, test, story"
```

---

## Task 6: `runNewNode` orchestration + CLI wiring

**Files:**
- Create: `packages/cli/src/commands/new-node.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/test/new-node.test.ts`

- [ ] **Step 1: Write failing E2E test in `packages/cli/test/new-node.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runNewNode } from "../src/commands/new-node.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmp: string;

const REGISTRY_SRC = `import { createRegistry } from "@kibadist/agentui-react";
// agentui:registry-imports-start
// agentui:registry-imports-end

export const registry = createRegistry({
  // agentui:registry-entries-start
  // agentui:registry-entries-end
});
`;

function seedHost(opts: { storybook?: boolean } = {}) {
  fs.mkdirSync(path.join(tmp, "components"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "components", "registry.ts"), REGISTRY_SRC);
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({
      name: "host",
      devDependencies: opts.storybook ? { "@storybook/react": "^8" } : {},
    }),
  );
  fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentui-e2e-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("runNewNode", () => {
  it("creates 3 files (no storybook) and inserts registry entry", () => {
    seedHost({ storybook: false });
    const result = runNewNode({ name: "QuoteCard", dryRun: false }, tmp);
    expect(result.ok).toBe(true);

    const comp = fs.readFileSync(path.join(tmp, "components", "quote-card.tsx"), "utf8");
    const schema = fs.readFileSync(path.join(tmp, "components", "quote-card.schema.ts"), "utf8");
    const test = fs.readFileSync(path.join(tmp, "components", "quote-card.test.tsx"), "utf8");
    expect(comp).toContain("export function QuoteCard");
    expect(schema).toContain("export const quoteCardSchema");
    expect(test).toContain("safeParse");

    expect(fs.existsSync(path.join(tmp, "components", "quote-card.stories.tsx"))).toBe(false);

    const registry = fs.readFileSync(path.join(tmp, "components", "registry.ts"), "utf8");
    expect(registry).toContain(`"quote-card":`);
    expect(registry).toContain(`import { QuoteCard }`);
  });

  it("creates story when Storybook detected", () => {
    seedHost({ storybook: true });
    const result = runNewNode({ name: "QuoteCard", dryRun: false }, tmp);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tmp, "components", "quote-card.stories.tsx"))).toBe(true);
  });

  it("fails idempotently — second run errors and does not modify files", () => {
    seedHost({ storybook: false });
    runNewNode({ name: "QuoteCard", dryRun: false }, tmp);

    const before = fs.statSync(path.join(tmp, "components", "quote-card.tsx")).mtimeMs;
    const result = runNewNode({ name: "QuoteCard", dryRun: false }, tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already exist/i);

    const after = fs.statSync(path.join(tmp, "components", "quote-card.tsx")).mtimeMs;
    expect(after).toBe(before);
  });

  it("fails when registry has no markers", () => {
    fs.mkdirSync(path.join(tmp, "components"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "components", "registry.ts"),
      `export const registry = createRegistry({});`,
    );
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "host" }));

    const result = runNewNode({ name: "QuoteCard", dryRun: false }, tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/markers/i);
    expect(fs.existsSync(path.join(tmp, "components", "quote-card.tsx"))).toBe(false);
  });

  it("fails when registry file missing", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "host" }));
    const result = runNewNode({ name: "QuoteCard", dryRun: false }, tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Registry not found/i);
  });

  it("rejects invalid name", () => {
    seedHost({ storybook: false });
    const result = runNewNode({ name: "quote-card", dryRun: false }, tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/PascalCase/);
    expect(fs.existsSync(path.join(tmp, "components", "quote-card.tsx"))).toBe(false);
  });

  it("dry-run writes nothing", () => {
    seedHost({ storybook: false });
    const result = runNewNode({ name: "QuoteCard", dryRun: true }, tmp);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tmp, "components", "quote-card.tsx"))).toBe(false);
    const registry = fs.readFileSync(path.join(tmp, "components", "registry.ts"), "utf8");
    expect(registry).not.toContain(`"quote-card":`);
  });

  it("respects componentsDir override", () => {
    seedHost({ storybook: false });
    // override config: put components in ./src/components
    fs.mkdirSync(path.join(tmp, "src", "components"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "components", "registry.ts"),
      REGISTRY_SRC,
    );
    fs.writeFileSync(
      path.join(tmp, "agentui.config.json"),
      JSON.stringify({ componentsDir: "./src/components" }),
    );
    const result = runNewNode({ name: "QuoteCard", dryRun: false }, tmp);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(tmp, "src", "components", "quote-card.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "components", "quote-card.tsx"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/new-node.test.ts
```

- [ ] **Step 3: Implement `packages/cli/src/commands/new-node.ts`**

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { validateName, toKebab } from "../core/name.js";
import { loadConfig } from "../core/config.js";
import { detectStorybook, detectPackageManager } from "../core/detect.js";
import {
  insertRegistryEntry,
  hasMarkers,
  hasEntryKey,
} from "../core/registry-edit.js";
import {
  renderComponent,
  renderSchema,
  renderTest,
  renderStory,
} from "../core/templates.js";

export interface NewNodeArgs {
  name: string;
  dryRun: boolean;
}

export type NewNodeResult =
  | { ok: true; created: string[]; storybook: string | null; pkgManager: string }
  | { ok: false; error: string };

export function runNewNode(args: NewNodeArgs, cwd: string): NewNodeResult {
  const v = validateName(args.name);
  if (!v.ok) return { ok: false, error: v.error };

  const kebab = toKebab(args.name);
  const schemaConst = lowerCamel(args.name) + "Schema";

  const cfg = loadConfig(cwd);
  const componentsAbs = path.resolve(cwd, cfg.componentsDir);
  const registryAbs = path.resolve(cwd, cfg.registry);

  if (!fs.existsSync(registryAbs)) {
    return {
      ok: false,
      error: `Registry not found at ${cfg.registry}. Set "registry" in agentui.config.json or create the file.`,
    };
  }

  const registrySrc = fs.readFileSync(registryAbs, "utf8");
  if (!hasMarkers(registrySrc)) {
    return {
      ok: false,
      error:
        `Registry file ${cfg.registry} has no agentui markers. Add these to enable auto-insertion:\n\n` +
        `  // agentui:registry-imports-start\n  // agentui:registry-imports-end\n\n  ...createRegistry({\n    // agentui:registry-entries-start\n    // agentui:registry-entries-end\n  });\n\nThen re-run.`,
    };
  }

  if (hasEntryKey(registrySrc, kebab)) {
    return {
      ok: false,
      error: `Registry already contains a "${kebab}" entry. Pick a different name.`,
    };
  }

  const storybookPreset = detectStorybook(cwd);
  const pkgManager = detectPackageManager(cwd);

  const componentFile = path.join(componentsAbs, `${kebab}.tsx`);
  const schemaFile = path.join(componentsAbs, `${kebab}.schema.ts`);
  const testFile = path.join(componentsAbs, `${kebab}.test.tsx`);
  const storyFile = path.join(componentsAbs, `${kebab}.stories.tsx`);

  const targets: string[] = [componentFile, schemaFile, testFile];
  if (storybookPreset) targets.push(storyFile);

  const conflicts = targets.filter((p) => fs.existsSync(p));
  if (conflicts.length > 0) {
    return {
      ok: false,
      error:
        `Cannot create ${args.name} — these files already exist:\n` +
        conflicts.map((p) => "  " + path.relative(cwd, p)).join("\n") +
        `\n\nDelete them and re-run, or pick a different name.`,
    };
  }

  const tplArgs = { pascalName: args.name, kebabName: kebab, schemaConst };
  const componentSrc = renderComponent(tplArgs);
  const schemaSrcOut = renderSchema(tplArgs);
  const testSrc = renderTest(tplArgs);
  const storySrc = storybookPreset ? renderStory(tplArgs) : null;

  const newRegistry = insertRegistryEntry(registrySrc, {
    kebabKey: kebab,
    pascalName: args.name,
    schemaConst,
    componentImportPath: `./${kebab}`,
    schemaImportPath: `./${kebab}.schema`,
  });

  if (args.dryRun) {
    return {
      ok: true,
      created: targets.map((p) => path.relative(cwd, p)),
      storybook: storybookPreset,
      pkgManager,
    };
  }

  fs.mkdirSync(componentsAbs, { recursive: true });
  fs.writeFileSync(componentFile, componentSrc);
  fs.writeFileSync(schemaFile, schemaSrcOut);
  fs.writeFileSync(testFile, testSrc);
  if (storySrc) fs.writeFileSync(storyFile, storySrc);
  fs.writeFileSync(registryAbs, newRegistry);

  return {
    ok: true,
    created: targets.map((p) => path.relative(cwd, p)),
    storybook: storybookPreset,
    pkgManager,
  };
}

function lowerCamel(pascal: string): string {
  return pascal[0].toLowerCase() + pascal.slice(1);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @kibadist/agentui exec vitest run test/new-node.test.ts
```

- [ ] **Step 5: Wire CLI dispatcher — replace `packages/cli/src/cli.ts`**

```ts
import { printHelp } from "./commands/help.js";
import { runNewNode } from "./commands/new-node.js";

const VERSION = "0.0.0";

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (args[0] === "new-node") {
    const name = args[1];
    const dryRun = args.includes("--dry-run");
    if (!name) {
      process.stderr.write("Usage: agentui new-node <PascalCaseName> [--dry-run]\n");
      return 1;
    }
    const result = runNewNode({ name, dryRun }, process.cwd());
    if (!result.ok) {
      process.stderr.write(result.error + "\n");
      return 1;
    }
    const verb = dryRun ? "Would create" : "Created";
    for (const f of result.created) {
      process.stdout.write(`  ${verb}: ${f}\n`);
    }
    process.stdout.write(`  ${verb} registry entry in registry file\n`);
    if (result.storybook) {
      process.stdout.write(`  Detected Storybook (${result.storybook}) — story scaffolded\n`);
    }
    if (!dryRun) {
      process.stdout.write(`\nNext: run \`${result.pkgManager} test\`\n`);
    }
    return 0;
  }
  process.stderr.write(`Unknown command: ${args[0]}\n\n`);
  printHelp();
  return 1;
}

process.exit(main(process.argv));
```

- [ ] **Step 6: Update `packages/cli/src/index.ts` to export internals for testing**

```ts
export { runNewNode } from "./commands/new-node.js";
export type { NewNodeArgs, NewNodeResult } from "./commands/new-node.js";
```

- [ ] **Step 7: Build, smoke-test**

```bash
pnpm --filter @kibadist/agentui build
mkdir -p /tmp/agentui-smoke && cd /tmp/agentui-smoke && rm -rf *
mkdir -p components
cat > components/registry.ts <<'EOF'
import { createRegistry } from "@kibadist/agentui-react";
// agentui:registry-imports-start
// agentui:registry-imports-end

export const registry = createRegistry({
  // agentui:registry-entries-start
  // agentui:registry-entries-end
});
EOF
echo '{"name":"smoke"}' > package.json
node /Users/max/agentui/packages/cli/dist/cli.js new-node QuoteCard
cat components/registry.ts
ls components/
cd /Users/max/agentui
```

Expected: success messages; `components/quote-card.tsx`, `.schema.ts`, `.test.tsx` exist; registry contains `"quote-card":` entry and the two new imports.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src packages/cli/test
git commit -m "feat(cli): new-node command — orchestration + CLI wiring + E2E tests"
```

---

## Task 7: Release plumbing — publish script, CHANGELOG, README

**Files:**
- Modify: `scripts/bump-and-publish.sh`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Add `packages/cli` to the publish script**

Modify `scripts/bump-and-publish.sh`, append `packages/cli` to the `PACKAGES` array. The final block becomes:

```bash
PACKAGES=(
  packages/protocol
  packages/validate
  packages/llm
  packages/react
  packages/nest
  packages/openai
  packages/ai
  packages/next
  packages/cli
)
```

- [ ] **Step 2: Add CHANGELOG entry**

Read `CHANGELOG.md` first. Then prepend a `## 0.6.3` block above the most recent version block:

```markdown
## 0.6.3

### Added
- `@kibadist/agentui` CLI package: `npx @kibadist/agentui new-node <PascalCaseName>` scaffolds a typed component (tsx + Zod schema + vitest scaffold), and inserts a registry entry via marker comments. Optional Storybook story when `@storybook/react` or `@storybook/nextjs` is detected in the host `package.json`.

### Notes
- Subsequent CLI commands (`init`, `add-registry-markers`) deferred to a later minor.
- Registry insertion requires the host project to add `// agentui:registry-imports-start|end` and `// agentui:registry-entries-start|end` marker comments one time.
```

- [ ] **Step 3: Add README subsection**

Read `README.md` first. Find the existing DevTools section (added in v0.6.2). Add this subsection immediately after it:

```markdown
### CLI generator

Scaffold a typed AgentUI component in one command:

```bash
npx @kibadist/agentui new-node QuoteCard
```

Creates `quote-card.tsx`, `quote-card.schema.ts`, and `quote-card.test.tsx` (plus `quote-card.stories.tsx` when Storybook is detected), and inserts a registry entry between the marker comments.

Optional config at `agentui.config.json`:

```json
{
  "registry": "./components/registry.ts",
  "componentsDir": "./components"
}
```

One-time setup in your registry file:

```ts
// agentui:registry-imports-start
// agentui:registry-imports-end

export const registry = createRegistry({
  // agentui:registry-entries-start
  // agentui:registry-entries-end
});
```
```

- [ ] **Step 4: Verify all checks pass**

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add scripts/bump-and-publish.sh CHANGELOG.md README.md
git commit -m "chore(cli): add to publish script, document in README, CHANGELOG for 0.6.3"
```

---

## Self-Review Notes

Coverage vs spec:
- §2 UX → Task 0 (help/version), Task 6 (new-node + dry-run)
- §3 Files generated → Task 5 templates, Task 6 e2e
- §4 Registry insertion + markers + bootstrap failure → Task 4 + Task 6 e2e
- §5 Config → Task 2
- §6.1 Name validation → Task 1
- §6.2 Kebab conversion → Task 1
- §6.3 Idempotency → Task 6 e2e
- §6.4 Storybook detection → Task 3 + Task 6 e2e
- §6.5 Package manager hint → Task 3 + Task 6 CLI wiring
- §7 Package layout → Task 0
- §8 Tests → distributed across all tasks
- §9 Release mechanics → Task 7
- §10 Out of scope — no tasks (intentional)

All function/type names are consistent across tasks: `validateName`, `toKebab`, `loadConfig`, `detectStorybook`, `detectPackageManager`, `insertRegistryEntry`, `hasMarkers`, `hasEntryKey`, `renderComponent`/`renderSchema`/`renderTest`/`renderStory`, `runNewNode`.
