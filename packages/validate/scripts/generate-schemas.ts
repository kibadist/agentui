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
