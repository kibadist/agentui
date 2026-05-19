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
