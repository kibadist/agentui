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
