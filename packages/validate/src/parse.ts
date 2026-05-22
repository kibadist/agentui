import type { ZodError } from "zod";
import type {
  UIEvent,
  ActionEvent,
  AgentWireEvent,
  CustomWireEvent,
} from "@kibadist/agentui-protocol";
import {
  uiEventSchema,
  actionEventSchema,
  agentWireEventSchema,
  RESERVED_PROTOCOL_OPS,
} from "./schemas.js";

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

// ─── AgentWireEvent parsers (UI + Tool events combined) ─────────────────────

export function parseAgentEvent(raw: unknown): AgentWireEvent {
  return agentWireEventSchema.parse(raw) as AgentWireEvent;
}

export function safeParseAgentEvent(
  raw: unknown,
): { ok: true; value: AgentWireEvent } | { ok: false; error: ValidationError } {
  const result = agentWireEventSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data as AgentWireEvent };
  }
  return { ok: false, error: new ValidationError(result.error) };
}

export function isAgentEvent(x: unknown): x is AgentWireEvent {
  return agentWireEventSchema.safeParse(x).success;
}

// ─── Custom Wire Events ─────────────────────────────────────────────────────

/**
 * Type predicate that returns `true` when the event's `op` is NOT a reserved
 * protocol op (`ui.*`, `tool.*`, `reasoning.*`, `optimistic.*`, `session.*`,
 * `workflow.*`). Use this in `subscribeAction` listeners to route
 * project-local wire events to your own handlers — the narrowing flows
 * through TypeScript so no cast is needed inside the guard.
 *
 * @example
 *   import { isCustomWireEvent } from "@kibadist/agentui-validate";
 *
 *   store.subscribeAction((action) => {
 *     if (isCustomWireEvent(action)) {
 *       // action is narrowed to CustomWireEvent here
 *       handleCustomOp(action);
 *     }
 *   });
 */
export function isCustomWireEvent<E extends { op: string }>(
  event: E,
): event is E & CustomWireEvent {
  return !RESERVED_PROTOCOL_OPS.has(event.op);
}
