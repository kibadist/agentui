import type { ZodError } from "zod";
import type { UIEvent, ActionEvent } from "@kibadist/agentui-protocol";
import { uiEventSchema, actionEventSchema } from "./schemas.js";

/** Validation error that preserves Zod issue details */
export class ValidationError extends Error {
  readonly issues: ZodError["issues"];

  constructor(zodError: ZodError) {
    super(zodError.message);
    this.name = "ValidationError";
    this.issues = zodError.issues;
  }
}

// ─── UIEvent parsers ─────────────────────────────────────────────────────────

export function parseUIEvent(raw: unknown): UIEvent {
  return uiEventSchema.parse(raw) as UIEvent;
}

export function safeParseUIEvent(
  raw: unknown,
): { ok: true; value: UIEvent } | { ok: false; error: ValidationError } {
  const result = uiEventSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data as UIEvent };
  }
  return { ok: false, error: new ValidationError(result.error) };
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
): { ok: true; value: ActionEvent } | { ok: false; error: ValidationError } {
  const result = actionEventSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data as ActionEvent };
  }
  return { ok: false, error: new ValidationError(result.error) };
}

export function isActionEvent(x: unknown): x is ActionEvent {
  return actionEventSchema.safeParse(x).success;
}
