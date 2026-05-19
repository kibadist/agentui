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
