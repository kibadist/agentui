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
  | "ui.navigate";

export interface UIAppendEvent extends BaseEvent {
  op: "ui.append";
  node: UINode;
  /** Optional insertion index (default: end) */
  index?: number;
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

export type UIEvent =
  | UIAppendEvent
  | UIReplaceEvent
  | UIRemoveEvent
  | UIToastEvent
  | UINavigateEvent;

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
