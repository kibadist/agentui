import type {
  AgentWireEvent,
  UIAppendEvent,
  UIReplaceEvent,
  UIToastEvent,
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
} from "@kibadist/agentui-protocol";

let counter = 0;
/** Generate a short unique id. Not cryptographic — adequate for in-stream correlation. */
export function generateId(prefix = "id"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export interface BaseEventInput {
  sessionId: string;
  ts?: string;
}

/** Build a BaseEvent with v/id/ts/sessionId fields filled in. */
function baseFields({ sessionId, ts }: BaseEventInput) {
  return {
    v: 1 as const,
    id: generateId("evt"),
    ts: ts ?? new Date().toISOString(),
    sessionId,
  };
}

export function makeAppendTextEvent(
  base: BaseEventInput,
  textKey: string,
  text: string,
): UIAppendEvent {
  return {
    ...baseFields(base),
    op: "ui.append",
    node: { key: textKey, type: "text-block", props: { text } },
  };
}

export function makeReplaceTextEvent(
  base: BaseEventInput,
  textKey: string,
  text: string,
): UIReplaceEvent {
  return {
    ...baseFields(base),
    op: "ui.replace",
    key: textKey,
    props: { text },
  };
}

export function makeToolStartEvent(
  base: BaseEventInput,
  toolId: string,
  name: string,
  args?: unknown,
): ToolCallStartEvent {
  const e: ToolCallStartEvent = {
    ...baseFields(base),
    op: "tool.start",
    id: toolId,
    name,
  };
  if (args !== undefined) e.args = args;
  return e;
}

export function makeToolArgsDeltaEvent(
  base: BaseEventInput,
  toolId: string,
  delta: string,
): ToolArgsDeltaEvent {
  return {
    ...baseFields(base),
    op: "tool.args-delta",
    id: toolId,
    delta,
  };
}

export function makeReasoningStartEvent(
  base: BaseEventInput,
  segmentId: string,
): ReasoningStartEvent {
  return {
    ...baseFields(base),
    op: "reasoning.start",
    id: segmentId,
  };
}

export function makeReasoningDeltaEvent(
  base: BaseEventInput,
  segmentId: string,
  delta: string,
): ReasoningDeltaEvent {
  return {
    ...baseFields(base),
    op: "reasoning.delta",
    id: segmentId,
    delta,
  };
}

export function makeReasoningEndEvent(
  base: BaseEventInput,
  segmentId: string,
): ReasoningEndEvent {
  return {
    ...baseFields(base),
    op: "reasoning.end",
    id: segmentId,
  };
}

export function makeToastEvent(
  base: BaseEventInput,
  level: "error",
  message: string,
): UIToastEvent {
  return {
    ...baseFields(base),
    op: "ui.toast",
    level,
    message,
  };
}

export type AnyWireEvent = AgentWireEvent;
