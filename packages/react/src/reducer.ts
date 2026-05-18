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
} from "@kibadist/agentui-protocol";

/** A transient notification queued by `ui.toast` events. */
export interface Toast {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  ts: string;
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
   * Best-effort parsed args. `undefined` while the buffered text is not
   * yet valid JSON; populated once it parses.
   */
  args: unknown | undefined;
  status: "pending" | "ok" | "error" | "cancelled";
  result?: unknown;
  error?: { message: string; code?: string };
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
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
  };
}

/**
 * @deprecated Use {@link createInitialAgentState} instead. This constant is a
 * single shared object whose `byKey` Map is reused across resets, which can
 * cause state aliasing between sessions. Kept for back-compat with v0.2.x.
 */
export const initialAgentState: AgentState = createInitialAgentState();

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
 */
export type AgentAction = UIEvent | ToolEvent | ReasoningEvent | AgentResetAction;

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
  if (idx === undefined) return state; // no-op if key not found
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
  let args: unknown | undefined;
  try {
    args = JSON.parse(argsRaw);
  } catch {
    args = undefined;
  }
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
      // already empty.
      return createInitialAgentState();
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
    default:
      return state;
  }
}
