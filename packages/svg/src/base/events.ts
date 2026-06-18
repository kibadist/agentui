// ─── Event contract ──────────────────────────────────────────────────────────
//
// Every component emits namespaced CustomEvents that BUBBLE and are COMPOSED,
// so they cross the shadow boundary and reach listeners on the host element and
// its ancestors. Event names are lowercase, colon-namespaced under `agentui:`.
//
// Listen with the host element:
//   el.addEventListener("agentui:select", (e) => e.detail.id)
//
// `detail` is always a plain, serializable object. The originating component
// instance is available as `event.target`.

export const AGENTUI_EVENT = {
  /** A node / item / state was selected (pointer or keyboard). */
  select: "agentui:select",
  /** A discrete action was invoked (button, affordance). */
  action: "agentui:action",
  /** A review decision was made on a checkpoint. */
  decision: "agentui:decision",
  /** An edit affordance was invoked (memory map). */
  edit: "agentui:edit",
  /** A remove affordance was invoked (memory map). */
  remove: "agentui:remove",
} as const;

export type AgentUIEventName =
  (typeof AGENTUI_EVENT)[keyof typeof AGENTUI_EVENT];

/** Discriminates what kind of thing a selection / action targets. */
export type AgentUITargetKind =
  | "node"
  | "edge"
  | "item"
  | "state"
  | "transition"
  | "link"
  | "checkpoint";

export interface SelectDetail {
  /** Id of the selected element from the source data. */
  id: string;
  kind: AgentUITargetKind;
  /** The matching data object, when available. */
  data?: unknown;
}

export interface ActionDetail {
  /** Application-defined action name. */
  action: string;
  /** Optional id of the element the action relates to. */
  id?: string;
  data?: unknown;
}

export interface DecisionDetail {
  /** continue | stop | revise. */
  action: string;
  /** Optional reviewer note. */
  note?: string;
}

export interface EditDetail {
  id: string;
  data?: unknown;
}

export interface RemoveDetail {
  id: string;
  data?: unknown;
}

export interface AgentUIEventMap {
  "agentui:select": CustomEvent<SelectDetail>;
  "agentui:action": CustomEvent<ActionDetail>;
  "agentui:decision": CustomEvent<DecisionDetail>;
  "agentui:edit": CustomEvent<EditDetail>;
  "agentui:remove": CustomEvent<RemoveDetail>;
}

/** Build a bubbling, composed CustomEvent with the shared defaults. */
export function makeEvent<T>(name: string, detail: T): CustomEvent<T> {
  return new CustomEvent<T>(name, {
    detail,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
}
