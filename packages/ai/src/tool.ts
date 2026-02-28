import { tool } from "ai";
import { z } from "zod";
import type { UIEvent } from "@kibadist/agentui-protocol";
import { safeParseUIEvent } from "@kibadist/agentui-validate";

export const UI_EMITTER_TOOL_NAME = "emit_ui_event";

export interface CreateUIEmitterToolOptions {
  /** Allowed component types from your registry */
  allowedTypes: string[];
  /** Session id injected into emitted events */
  sessionId: string;
  /** Called for each valid UI event produced by the model */
  onUIEvent: (event: UIEvent) => void;
}

/**
 * Creates an AI SDK tool for emitting UI events.
 *
 * Uses a flat object schema (not discriminatedUnion) so the JSON schema
 * root is always `{ type: "object" }`, which is required by
 * OpenAI-compatible providers like DeepSeek.
 */
export function createUIEmitterTool(opts: CreateUIEmitterToolOptions) {
  const { allowedTypes, sessionId, onUIEvent } = opts;

  const typesEnum = z.enum(allowedTypes as [string, ...string[]]);

  const inputSchema = z.object({
    op: z.enum([
      "ui.append",
      "ui.replace",
      "ui.remove",
      "ui.toast",
      "ui.navigate",
    ]),
    // ui.append fields
    node: z
      .object({
        key: z.string().min(1),
        type: typesEnum,
        props: z.record(z.string(), z.any()),
        slot: z.string().optional(),
      })
      .optional(),
    index: z.number().int().nonnegative().optional(),
    // ui.replace / ui.remove fields
    key: z.string().optional(),
    props: z.record(z.string(), z.any()).optional(),
    replace: z.boolean().optional(),
    // ui.toast fields
    level: z.enum(["info", "success", "warning", "error"]).optional(),
    message: z.string().optional(),
    // ui.navigate fields
    href: z.string().optional(),
  });

  return tool({
    description:
      "Emit a UI event to render, update, or remove a component on the user's screen. " +
      "Each call produces exactly one patch operation.",
    inputSchema,
    execute: async (args) => {
      const event = {
        ...args,
        v: 1 as const,
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        sessionId,
      };

      const parsed = safeParseUIEvent(event);
      if (parsed.ok) {
        onUIEvent(parsed.value);
        return { ok: true, eventId: event.id };
      }
      return { ok: false, error: parsed.error.message };
    },
  });
}
