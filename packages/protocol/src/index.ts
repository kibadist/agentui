// ─── Base ────────────────────────────────────────────────────────────────────

export interface BaseEvent {
  /** Protocol version – always 1 for v1 */
  v: 1;
  /** Unique event id (uuid) */
  id: string;
  /** ISO-8601 timestamp */
  ts: string;
  /** Optional trace id to correlate across tool calls / steps */
  traceId?: string;
  /** Session this event belongs to */
  sessionId: string;
}

// ─── UI Nodes ────────────────────────────────────────────────────────────────

export interface UINode {
  /** Stable identity used for patching */
  key: string;
  /** Registry key, e.g. "purchase.checkout" */
  type: string;
  /** Props forwarded to the registered component */
  props: Record<string, unknown>;
  /** Optional layout slot: "main" | "sidebar" etc. */
  slot?: string;
  /** Optional nested children (v1: flat list recommended) */
  children?: UINode[];
  /** Component-level metadata */
  meta?: {
    /** Auto-remove after N ms */
    ttlMs?: number;
    /** Capability requirements, e.g. ["AUTH"] */
    requires?: string[];
  };
}

// ─── UI Patch Events ─────────────────────────────────────────────────────────

export type UIPatchOp =
  | "ui.append"
  | "ui.replace"
  | "ui.remove"
  | "ui.toast"
  | "ui.navigate"
  | "ui.reset";

export interface UIAppendEvent extends BaseEvent {
  op: "ui.append";
  node: UINode;
  /** Optional insertion index (default: end) */
  index?: number;
  /** Optional turn correlation id; consumer can read it via `onEvent`. */
  turnId?: string;
}

export interface UIReplaceEvent extends BaseEvent {
  op: "ui.replace";
  /** Key of the node to patch */
  key: string;
  /** New / merged props */
  props: Record<string, unknown>;
  /** If true, fully replace props; if false (default), shallow-merge */
  replace?: boolean;
}

export interface UIRemoveEvent extends BaseEvent {
  op: "ui.remove";
  /** Key of the node to remove */
  key: string;
}

export interface UIToastEvent extends BaseEvent {
  op: "ui.toast";
  level: "info" | "success" | "warning" | "error";
  message: string;
}

export interface UINavigateEvent extends BaseEvent {
  op: "ui.navigate";
  href: string;
  /** If true, replace current history entry */
  replace?: boolean;
}

/**
 * Clears all client-side UI state (nodes, toasts, pending navigate).
 * Use to signal end-of-conversation, summarizer flush, or rollback.
 */
export interface UIResetEvent extends BaseEvent {
  op: "ui.reset";
}

export type UIEvent =
  | UIAppendEvent
  | UIReplaceEvent
  | UIRemoveEvent
  | UIToastEvent
  | UINavigateEvent
  | UIResetEvent;

// ─── Tool-Call Events (server → client) ─────────────────────────────────────

export interface ToolCallStartEvent extends BaseEvent {
  op: "tool.start";
  /** Tool-call id, unique per session. Shared across tool.* events for the same call. */
  id: string;
  /** Tool name, e.g. "search_clients". */
  name: string;
  /** Optional initial args; may also stream via tool.args-delta. */
  args?: unknown;
  /** Optional turn correlation id (see ReasoningStartEvent for the cross-cut). */
  turnId?: string;
}

export interface ToolArgsDeltaEvent extends BaseEvent {
  op: "tool.args-delta";
  /** Tool-call id this delta belongs to. */
  id: string;
  /** Partial JSON text to append to argsRaw. */
  delta: string;
}

export interface ToolCallResultEvent extends BaseEvent {
  op: "tool.result";
  /** Tool-call id this result belongs to. */
  id: string;
  status: "ok" | "error";
  result?: unknown;
  error?: { message: string; code?: string };
  durationMs?: number;
}

export interface ToolCallCancelEvent extends BaseEvent {
  op: "tool.cancel";
  /** Tool-call id being cancelled. */
  id: string;
}

export type ToolEvent =
  | ToolCallStartEvent
  | ToolArgsDeltaEvent
  | ToolCallResultEvent
  | ToolCallCancelEvent;

export type ToolEventOp = ToolEvent["op"];

// ─── Reasoning / Thinking Events (server → client) ──────────────────────────

export interface ReasoningStartEvent extends BaseEvent {
  op: "reasoning.start";
  /** Reasoning-segment id, shared across reasoning.* events for the same segment. */
  id: string;
  /** Optional turn correlation id. */
  turnId?: string;
}

export interface ReasoningDeltaEvent extends BaseEvent {
  op: "reasoning.delta";
  /** Reasoning-segment id this delta belongs to. */
  id: string;
  /** Partial text to append to the segment. */
  delta: string;
}

export interface ReasoningEndEvent extends BaseEvent {
  op: "reasoning.end";
  /** Reasoning-segment id being finalized. */
  id: string;
  /** Optional final token count. */
  tokens?: number;
}

export type ReasoningEvent =
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent;

export type ReasoningEventOp = ReasoningEvent["op"];

/** All wire events flowing server → client (UI patches + tool calls + reasoning). */
export type AgentWireEvent = UIEvent | ToolEvent | ReasoningEvent;

// ─── Action Events (user → agent) ───────────────────────────────────────────

export interface ActionBase extends BaseEvent {
  kind: "action";
  /** Stable action id, e.g. "purchase.confirm" */
  name: string;
  /** Arbitrary payload */
  payload?: Record<string, unknown>;
  /** Source component key (optional) */
  uiKey?: string;
}

export interface ActionSubmitEvent extends ActionBase {
  type: "action.submit";
}

export interface ActionSelectEvent extends ActionBase {
  type: "action.select";
}

export interface ActionApproveEvent extends ActionBase {
  type: "action.approve";
  approved: boolean;
}

export interface ActionGenericEvent extends ActionBase {
  type: "action";
}

export type ActionEvent =
  | ActionSubmitEvent
  | ActionSelectEvent
  | ActionApproveEvent
  | ActionGenericEvent;

// ─── Utility types ───────────────────────────────────────────────────────────

/** All event types flowing over the wire */
export type AgentUIEvent = UIEvent | ActionEvent;

/** Discriminant helpers */
export type UIEventOp = UIEvent["op"];
export type ActionEventType = ActionEvent["type"];
