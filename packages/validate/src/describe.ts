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
  try {
    const def = schema._def;
    const typeName: string = def?.typeName ?? "";

    // Unwrap optional/nullable
    if (typeName === "ZodOptional") {
      return describeField(def.innerType) + ", optional";
    }
    if (typeName === "ZodNullable") {
      return describeField(def.innerType) + ", nullable";
    }
    if (typeName === "ZodDefault") {
      const inner = describeField(def.innerType);
      try {
        return inner + `, default: ${JSON.stringify(def.defaultValue())}`;
      } catch {
        return inner + ", has default";
      }
    }

    // Primitives
    if (typeName === "ZodString") return "string";
    if (typeName === "ZodNumber") return "number";
    if (typeName === "ZodBoolean") return "boolean";

    // Enum
    if (typeName === "ZodEnum") {
      const vals = def.values as string[];
      if (!vals?.length) return "string";
      return vals.map((v) => `"${v}"`).join(" | ");
    }

    // Native enum
    if (typeName === "ZodNativeEnum") return "enum";

    // Literal
    if (typeName === "ZodLiteral") {
      return JSON.stringify(def.value);
    }

    // Array
    if (typeName === "ZodArray") {
      const inner = describeField(def.type);
      return `array of ${inner}`;
    }

    // Tuple
    if (typeName === "ZodTuple") {
      const items = (def.items as z.ZodTypeAny[]).map(describeField);
      return `[${items.join(", ")}]`;
    }

    // Object (nested)
    if (typeName === "ZodObject") {
      const shapeFn = def.shape;
      const shape = typeof shapeFn === "function" ? shapeFn() : shapeFn;
      const keys = Object.keys(shape ?? {});
      if (keys.length > 0) {
        return `object { ${keys.join(", ")} }`;
      }
      return "object";
    }

    // Record
    if (typeName === "ZodRecord") return "object";

    // Union
    if (typeName === "ZodUnion") {
      const options = (def.options as z.ZodTypeAny[]).map(describeField);
      return options.join(" | ");
    }

    // Discriminated union
    if (typeName === "ZodDiscriminatedUnion") {
      const options = ([...def.options.values()] as z.ZodTypeAny[]).map(describeField);
      return options.join(" | ");
    }

    // Intersection
    if (typeName === "ZodIntersection") {
      const left = describeField(def.left);
      const right = describeField(def.right);
      return `${left} & ${right}`;
    }

    return "any";
  } catch {
    return "any";
  }
}
