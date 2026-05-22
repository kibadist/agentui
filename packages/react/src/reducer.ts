import type {
  UIEvent,
  UINode,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
  ToolEvent,
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ToolCallResultEvent,
  ToolCallCancelEvent,
  ReasoningEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  OptimisticEvent,
  OptimisticApplyEvent,
  OptimisticConfirmEvent,
  OptimisticRollbackEvent,
  SessionMetaEvent,
  SessionInitEvent,
  WorkflowEvent,
  WorkflowStartEvent,
  WorkflowAdvanceEvent,
  WorkflowCompleteEvent,
  WorkflowCancelEvent,
} from "@kibadist/agentui-protocol";
import { parsePartialJson } from "./partial-json.js";

/** A transient notification queued by `ui.toast` events. */
export interface Toast {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  ts: string;
}

export interface Capabilities {
  declared: boolean;
  nodeTypes: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
}

/** A locally-applied optimistic patch awaiting server confirmation or rollback. */
export interface OptimisticEntry {
  entityKey: string;
  patch: Record<string, unknown>;
  /** Unique id of this application (different per apply, even for same entityKey). */
  originId: string;
  appliedAt: string;
  /** Computed from `ttlMs` at apply time; host implements actual TTL via useEffect. */
  expiresAt?: string;
}

/** A streaming or completed reasoning segment captured from the wire. */
export interface ReasoningSegment {
  id: string;
  /** Accumulated text from `reasoning.delta` events. */
  text: string;
  status: "streaming" | "done";
  startedAt: string;
  endedAt?: string;
  /** Optional final token count from `reasoning.end`. */
  tokens?: number;
  /** Optional turn correlation, set by `reasoning.start`. */
  turnId?: string;
}

/** A streaming or completed tool call captured from the wire. */
export interface ToolCall {
  id: string;
  name: string;
  /** Optional turn correlation, captured from `tool.start`. */
  turnId?: string;
  /**
   * Accumulated JSON text from `tool.args-delta` events. If `tool.start`
   * supplied initial `args`, this starts as `JSON.stringify(args)`.
   */
  argsRaw: string;
  /**
   * Parsed args, kept up-to-date after each `tool.args-delta` via tolerant
   * partial-JSON repair. `undefined` only when the buffer can't be repaired
   * (e.g. before any structured token has arrived).
   */
  args: unknown | undefined;
  status: "pending" | "ok" | "error" | "cancelled";
  result?: unknown;
  error?: { message: string; code?: string };
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

export type WorkflowStatus = "active" | "completed" | "cancelled";
export type WorkflowStepStatus = "pending" | "current" | "completed" | "skipped";

export interface WorkflowStep {
  id: string;
  title: string;
  nodeKey?: string;
  status: WorkflowStepStatus;
}

export interface Workflow {
  id: string;
  steps: WorkflowStep[];
  currentStepId: string;
  status: WorkflowStatus;
  result?: unknown;
  reason?: string;
  startedAt: string;
  endedAt?: string;
}

/**
 * The reducer's state shape. `nodes` is the ordered list of rendered UI nodes;
 * `byKey` maps each node's key to its index for O(1) lookup; `toasts` is the
 * queue of un-dismissed notifications; `navigate` is the latest pending
 * navigation intent (or null); `toolCalls` is the streaming/completed tool
 * calls keyed by their wire id; `toolCallsOrder` is the stable insertion order.
 */
export interface AgentState {
  nodes: UINode[];
  byKey: Map<string, number>; // key → index in nodes[]
  toasts: Toast[];
  navigate: { href: string; replace?: boolean } | null;
  toolCalls: Map<string, ToolCall>;
  toolCallsOrder: string[];
  reasoning: Map<string, ReasoningSegment>;
  reasoningOrder: string[];
  optimistic: Map<string, OptimisticEntry>;
  capabilities: Capabilities;
  workflows: Map<string, Workflow>;
}

/**
 * Create a fresh empty `AgentState`. Returns new Maps/arrays per call —
 * safe to call multiple times without aliasing.
 */
export function createInitialAgentState(): AgentState {
  return {
    nodes: [],
    byKey: new Map(),
    toasts: [],
    navigate: null,
    toolCalls: new Map(),
    toolCallsOrder: [],
    reasoning: new Map(),
    reasoningOrder: [],
    optimistic: new Map(),
    capabilities: {
      declared: false,
      nodeTypes: new Set(),
      actions: new Set(),
      permissions: new Set(),
    },
    workflows: new Map(),
  };
}

/**
 * Synthetic, client-only action used by `useAgentStream().reset()`.
 * Not a wire protocol event — server-driven resets use `ui.reset`.
 */
export interface AgentResetAction {
  op: "__reset__";
}

/**
 * Discriminated union over actions accepted by {@link agentReducer}: any
 * `UIEvent`, any `ToolEvent`, any `ReasoningEvent` (pass-through, no state
 * change), plus the synthetic `__reset__` action.
 *
 * Custom wire events (`CustomWireEvent`, e.g. `host.*`) also flow through
 * `store.send` at runtime — the reducer's `default` case no-ops them, and
 * `subscribeAction` listeners observe them. They are not in this union
 * type for narrowing reasons; consumers cast to `CustomWireEvent` when
 * needed.
 */
export type AgentAction =
  | UIEvent
  | ToolEvent
  | ReasoningEvent
  | OptimisticEvent
  | SessionMetaEvent
  | SessionInitEvent
  | WorkflowEvent
  | AgentResetAction;

function rebuildIndex(nodes: UINode[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    m.set(nodes[i].key, i);
  }
  return m;
}

function applyAppend(state: AgentState, e: UIAppendEvent): AgentState {
  const nodes = [...state.nodes];
  if (e.index !== undefined && e.index >= 0 && e.index <= nodes.length) {
    nodes.splice(e.index, 0, e.node);
  } else {
    nodes.push(e.node);
  }
  return { ...state, nodes, byKey: rebuildIndex(nodes) };
}

function applyReplace(state: AgentState, e: UIReplaceEvent): AgentState {
  const idx = state.byKey.get(e.key);
  if (idx === undefined) return state;
  if (!("props" in e) || e.props === undefined) return state;
  const nodes = [...state.nodes];
  const existing = nodes[idx];
  nodes[idx] = {
    ...existing,
    props: e.replace ? { ...e.props } : { ...existing.props, ...e.props },
  };
  return { ...state, nodes, byKey: rebuildIndex(nodes) };
}

function applyRemove(state: AgentState, e: UIRemoveEvent): AgentState {
  const idx = state.byKey.get(e.key);
  if (idx === undefined) return state;
  const nodes = [...state.nodes];
  nodes.splice(idx, 1);
  return { ...state, nodes, byKey: rebuildIndex(nodes) };
}

/** Max number of toasts kept in state to prevent unbounded growth */
const MAX_TOASTS = 50;

function applyToast(state: AgentState, e: UIToastEvent): AgentState {
  const toast: Toast = { id: e.id, level: e.level, message: e.message, ts: e.ts };
  const toasts = [...state.toasts, toast];
  return { ...state, toasts: toasts.length > MAX_TOASTS ? toasts.slice(-MAX_TOASTS) : toasts };
}

function applyToolStart(state: AgentState, e: ToolCallStartEvent): AgentState {
  if (state.toolCalls.has(e.id)) return state; // duplicate id — silent no-op
  const argsRaw = e.args !== undefined ? JSON.stringify(e.args) : "";
  const newCall: ToolCall = {
    id: e.id,
    name: e.name,
    argsRaw,
    args: e.args,
    status: "pending",
    startedAt: e.ts,
    turnId: e.turnId,
  };
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, newCall);
  return {
    ...state,
    toolCalls,
    toolCallsOrder: [...state.toolCallsOrder, e.id],
  };
}

function applyToolArgsDelta(state: AgentState, e: ToolArgsDeltaEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const argsRaw = existing.argsRaw + e.delta;
  const args = parsePartialJson(argsRaw);
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, { ...existing, argsRaw, args });
  return { ...state, toolCalls };
}

function applyToolResult(state: AgentState, e: ToolCallResultEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, {
    ...existing,
    status: e.status,
    result: e.result,
    error: e.error,
    endedAt: e.ts,
    durationMs: e.durationMs,
  });
  return { ...state, toolCalls };
}

function applyToolCancel(state: AgentState, e: ToolCallCancelEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, { ...existing, status: "cancelled", endedAt: e.ts });
  return { ...state, toolCalls };
}

function applyReasoningStart(state: AgentState, e: ReasoningStartEvent): AgentState {
  if (state.reasoning.has(e.id)) return state; // duplicate id — silent no-op
  const seg: ReasoningSegment = {
    id: e.id,
    text: "",
    status: "streaming",
    startedAt: e.ts,
    turnId: e.turnId,
  };
  const reasoning = new Map(state.reasoning);
  reasoning.set(e.id, seg);
  return {
    ...state,
    reasoning,
    reasoningOrder: [...state.reasoningOrder, e.id],
  };
}

function applyReasoningDelta(state: AgentState, e: ReasoningDeltaEvent): AgentState {
  const existing = state.reasoning.get(e.id);
  if (!existing || existing.status !== "streaming") return state;
  const reasoning = new Map(state.reasoning);
  reasoning.set(e.id, { ...existing, text: existing.text + e.delta });
  return { ...state, reasoning };
}

function applyReasoningEnd(state: AgentState, e: ReasoningEndEvent): AgentState {
  const existing = state.reasoning.get(e.id);
  if (!existing || existing.status !== "streaming") return state;
  const reasoning = new Map(state.reasoning);
  reasoning.set(e.id, {
    ...existing,
    status: "done",
    endedAt: e.ts,
    tokens: e.tokens,
  });
  return { ...state, reasoning };
}

function applyOptimisticApply(state: AgentState, e: OptimisticApplyEvent): AgentState {
  // Last-write-wins: overwrites any prior entry for the same entityKey.
  const expiresAt =
    e.ttlMs !== undefined
      ? new Date(Date.parse(e.ts) + e.ttlMs).toISOString()
      : undefined;
  const entry: OptimisticEntry = {
    entityKey: e.entityKey,
    patch: e.patch,
    originId: e.originId,
    appliedAt: e.ts,
    expiresAt,
  };
  const optimistic = new Map(state.optimistic);
  optimistic.set(e.entityKey, entry);
  return { ...state, optimistic };
}

function applyOptimisticConfirm(state: AgentState, e: OptimisticConfirmEvent): AgentState {
  // Look up by originId — not entityKey. Iterate the Map; remove on match.
  for (const [key, entry] of state.optimistic) {
    if (entry.originId === e.originId) {
      const optimistic = new Map(state.optimistic);
      optimistic.delete(key);
      return { ...state, optimistic };
    }
  }
  return state; // no match — silent no-op (stale confirmation)
}

function applyOptimisticRollback(state: AgentState, e: OptimisticRollbackEvent): AgentState {
  // Identical reducer logic to confirm: remove by originId. The semantic
  // distinction (acknowledged vs. rejected) lives at the host layer.
  for (const [key, entry] of state.optimistic) {
    if (entry.originId === e.originId) {
      const optimistic = new Map(state.optimistic);
      optimistic.delete(key);
      return { ...state, optimistic };
    }
  }
  return state;
}

function applyWorkflowStart(state: AgentState, e: WorkflowStartEvent): AgentState {
  if (state.workflows.has(e.id)) return state;
  if (e.steps.length === 0) return state;
  const steps: WorkflowStep[] = e.steps.map((s, i) => ({
    id: s.id,
    title: s.title,
    nodeKey: s.nodeKey,
    status: i === 0 ? "current" : "pending",
  }));
  const wf: Workflow = {
    id: e.id,
    steps,
    currentStepId: e.steps[0].id,
    status: "active",
    startedAt: e.ts,
  };
  const workflows = new Map(state.workflows);
  workflows.set(e.id, wf);
  return { ...state, workflows };
}

function applyWorkflowAdvance(state: AgentState, e: WorkflowAdvanceEvent): AgentState {
  const existing = state.workflows.get(e.id);
  if (!existing || existing.status !== "active") return state;
  if (existing.currentStepId === e.stepId) return state;
  const pos = existing.steps.findIndex((s) => s.id === e.stepId);
  if (pos < 0) return state;
  const steps: WorkflowStep[] = existing.steps.map((s, i) => ({
    ...s,
    status: i < pos ? "completed" : i === pos ? "current" : "pending",
  }));
  const workflows = new Map(state.workflows);
  workflows.set(e.id, { ...existing, steps, currentStepId: e.stepId });
  return { ...state, workflows };
}

function applyWorkflowComplete(state: AgentState, e: WorkflowCompleteEvent): AgentState {
  const existing = state.workflows.get(e.id);
  if (!existing || existing.status !== "active") return state;
  const workflows = new Map(state.workflows);
  workflows.set(e.id, {
    ...existing,
    status: "completed",
    result: e.result,
    endedAt: e.ts,
  });
  return { ...state, workflows };
}

function applyWorkflowCancel(state: AgentState, e: WorkflowCancelEvent): AgentState {
  const existing = state.workflows.get(e.id);
  if (!existing || existing.status !== "active") return state;
  const workflows = new Map(state.workflows);
  workflows.set(e.id, {
    ...existing,
    status: "cancelled",
    reason: e.reason,
    endedAt: e.ts,
  });
  return { ...state, workflows };
}

function applySessionInit(state: AgentState, e: SessionInitEvent): AgentState {
  return {
    ...state,
    capabilities: {
      declared: true,
      nodeTypes: new Set(e.capabilities.nodeTypes),
      actions: new Set(e.capabilities.actions),
      permissions: new Set(e.capabilities.permissions),
    },
  };
}

/**
 * Pure reducer over `AgentState`. Returns the same state reference for
 * no-op actions (e.g., `ui.replace` for an unknown key, `tool.result` for
 * a cancelled or unknown tool call), which lets stores short-circuit
 * listener notifications.
 */
export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.op) {
    case "ui.append":
      return applyAppend(state, action);
    case "ui.replace":
      return applyReplace(state, action);
    case "ui.remove":
      return applyRemove(state, action);
    case "ui.toast":
      return applyToast(state, action);
    case "ui.navigate":
      return { ...state, navigate: { href: action.href, replace: action.replace } };
    case "ui.reset":
    case "__reset__":
      // Stance: reset is always a full clear — nodes, toasts, navigate, AND
      // tool calls. Pending navigates are stale intent ("go to /foo" issued
      // by a prior turn); after a reset we're starting over and shouldn't
      // fire them. Always return a fresh reference, even when state is
      // already empty. Capabilities survive the reset — they describe the
      // session's permission contract, not transient UI state.
      return { ...createInitialAgentState(), capabilities: state.capabilities };
    case "session.init":
      return applySessionInit(state, action);
    case "tool.start":
      return applyToolStart(state, action);
    case "tool.args-delta":
      return applyToolArgsDelta(state, action);
    case "tool.result":
      return applyToolResult(state, action);
    case "tool.cancel":
      return applyToolCancel(state, action);
    case "reasoning.start":
      return applyReasoningStart(state, action);
    case "reasoning.delta":
      return applyReasoningDelta(state, action);
    case "reasoning.end":
      return applyReasoningEnd(state, action);
    case "optimistic.apply":
      return applyOptimisticApply(state, action);
    case "optimistic.confirm":
      return applyOptimisticConfirm(state, action);
    case "optimistic.rollback":
      return applyOptimisticRollback(state, action);
    case "workflow.start":
      return applyWorkflowStart(state, action);
    case "workflow.advance":
      return applyWorkflowAdvance(state, action);
    case "workflow.complete":
      return applyWorkflowComplete(state, action);
    case "workflow.cancel":
      return applyWorkflowCancel(state, action);
    default:
      return state;
  }
}
