import type { UIEvent, ActionEvent } from "@agentui/protocol";
import { uiEventSchema, actionEventSchema } from "./schemas.js";

// ─── UIEvent parsers ─────────────────────────────────────────────────────────

export function parseUIEvent(raw: unknown): UIEvent {
  return uiEventSchema.parse(raw) as UIEvent;
}

export function safeParseUIEvent(
  raw: unknown,
): { ok: true; value: UIEvent } | { ok: false; error: Error } {
  const result = uiEventSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data as UIEvent };
  }
  return { ok: false, error: new Error(result.error.message) };
}

export function isUIEvent(x: unknown): x is UIEvent {
  return uiEventSchema.safeParse(x).success;
}

// ─── ActionEvent parsers ─────────────────────────────────────────────────────

export function parseActionEvent(raw: unknown): ActionEvent {
  return actionEventSchema.parse(raw) as ActionEvent;
}

export function safeParseActionEvent(
  raw: unknown,
): { ok: true; value: ActionEvent } | { ok: false; error: Error } {
  const result = actionEventSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data as ActionEvent };
  }
  return { ok: false, error: new Error(result.error.message) };
}

export function isActionEvent(x: unknown): x is ActionEvent {
  return actionEventSchema.safeParse(x).success;
}
