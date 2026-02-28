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
 * The returned tool uses a Zod `discriminatedUnion` on `op` so the model
 * can only produce valid UI patch operations with your registered component types.
 */
export function createUIEmitterTool(opts: CreateUIEmitterToolOptions) {
  const { allowedTypes, sessionId, onUIEvent } = opts;

  const typesEnum = z.enum(allowedTypes as [string, ...string[]]);

  const appendSchema = z.object({
    op: z.literal("ui.append"),
    node: z.object({
      key: z.string().min(1),
      type: typesEnum,
      props: z.record(z.string(), z.any()),
      slot: z.string().optional(),
    }),
    index: z.number().int().nonnegative().optional(),
  });

  const replaceSchema = z.object({
    op: z.literal("ui.replace"),
    key: z.string().min(1),
    props: z.record(z.string(), z.any()),
    replace: z.boolean().optional(),
  });

  const removeSchema = z.object({
    op: z.literal("ui.remove"),
    key: z.string().min(1),
  });

  const toastSchema = z.object({
    op: z.literal("ui.toast"),
    level: z.enum(["info", "success", "warning", "error"]),
    message: z.string().min(1),
  });

  const navigateSchema = z.object({
    op: z.literal("ui.navigate"),
    href: z.string().min(1),
    replace: z.boolean().optional(),
  });

  const inputSchema = z.discriminatedUnion("op", [
    appendSchema,
    replaceSchema,
    removeSchema,
    toastSchema,
    navigateSchema,
  ]);

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
