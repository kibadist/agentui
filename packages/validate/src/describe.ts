import type { z } from "zod";

export interface ComponentDef {
  /** Human-readable description shown to the agent */
  description?: string;
  /** Zod schema for the component's props */
  propsSchema: z.ZodObject<any>;
}

/**
 * Generate a system-prompt-friendly description of available components
 * by introspecting Zod prop schemas.
 *
 * Example output:
 *   1. "text-block"
 *      - title (string, optional): heading text
 *      - body (string): markdown or plain text content
 */
export function describeComponents(
  defs: Record<string, ComponentDef>,
): string {
  const lines: string[] = [];
  let i = 1;

  for (const [type, def] of Object.entries(defs)) {
    lines.push(`${i}. "${type}"${def.description ? ` – ${def.description}` : ""}`);

    const shape = def.propsSchema.shape;
    for (const [prop, fieldSchema] of Object.entries<z.ZodTypeAny>(shape)) {
      const info = describeField(fieldSchema);
      const desc = fieldSchema.description ? `: ${fieldSchema.description}` : "";
      lines.push(`   - ${prop} (${info})${desc}`);
    }

    lines.push("");
    i++;
  }

  return lines.join("\n").trimEnd();
}

function describeField(schema: z.ZodTypeAny): string {
  const def = schema._def;
  const typeName: string = def.typeName ?? "";

  // Unwrap optional/nullable
  if (typeName === "ZodOptional") {
    return describeField(def.innerType) + ", optional";
  }
  if (typeName === "ZodNullable") {
    return describeField(def.innerType) + ", nullable";
  }
  if (typeName === "ZodDefault") {
    return describeField(def.innerType) + `, default: ${JSON.stringify(def.defaultValue())}`;
  }

  // Primitives
  if (typeName === "ZodString") return "string";
  if (typeName === "ZodNumber") return "number";
  if (typeName === "ZodBoolean") return "boolean";

  // Enum
  if (typeName === "ZodEnum") {
    const vals = (def.values as string[]).map((v) => `"${v}"`).join(" | ");
    return vals;
  }

  // Literal
  if (typeName === "ZodLiteral") {
    return JSON.stringify(def.value);
  }

  // Array
  if (typeName === "ZodArray") {
    const inner = describeField(def.type);
    return `array of ${inner}`;
  }

  // Object (nested)
  if (typeName === "ZodObject") {
    const keys = Object.keys(def.shape?.() ?? {});
    if (keys.length > 0) {
      return `object { ${keys.join(", ")} }`;
    }
    return "object";
  }

  // Record
  if (typeName === "ZodRecord") {
    return "object";
  }

  // Union
  if (typeName === "ZodUnion") {
    const options = (def.options as z.ZodTypeAny[]).map(describeField);
    return options.join(" | ");
  }

  return "any";
}
