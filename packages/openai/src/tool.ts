import type { Registry } from "./types.js";

export const UI_EMITTER_TOOL_NAME = "emit_ui_event";

/**
 * Creates an OpenAI function-tool definition for emitting UI events.
 *
 * Pass the result into your `tools` array when calling chat completions.
 * The `allowedTypes` param populates the enum so the model only emits
 * known component types.
 */
export function createUIEmitterTool(allowedTypes: string[]) {
  return {
    type: "function" as const,
    function: {
      name: UI_EMITTER_TOOL_NAME,
      description:
        "Emit a UI event to render, update, or remove a component on the user's screen. " +
        "Each call produces exactly one patch operation.",
      parameters: {
        type: "object",
        required: ["op"],
        properties: {
          op: {
            type: "string",
            enum: ["ui.append", "ui.replace", "ui.remove", "ui.toast", "ui.navigate"],
            description: "The patch operation to perform.",
          },
          // ui.append fields
          node: {
            type: "object",
            description: "The UI node to append (required for ui.append).",
            properties: {
              key: { type: "string", description: "Stable identity key." },
              type: {
                type: "string",
                enum: allowedTypes,
                description: "Component type from the registry.",
              },
              props: {
                type: "object",
                description: "Props forwarded to the component.",
              },
              slot: { type: "string", description: "Layout slot (optional)." },
            },
            required: ["key", "type", "props"],
          },
          index: {
            type: "integer",
            description: "Insertion index for ui.append (optional).",
          },
          // ui.replace / ui.remove fields
          key: {
            type: "string",
            description: "Key of the node to replace or remove.",
          },
          props: {
            type: "object",
            description: "New props for ui.replace.",
          },
          replace: {
            type: "boolean",
            description: "If true, fully replace props instead of merging (ui.replace).",
          },
          // ui.toast fields
          level: {
            type: "string",
            enum: ["info", "success", "warning", "error"],
          },
          message: { type: "string", description: "Toast message text." },
          // ui.navigate fields
          href: { type: "string", description: "URL for ui.navigate." },
        },
      },
    },
  };
}
