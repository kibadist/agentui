import type {
  UIEvent,
  UINode,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
} from "@kibadist/agentui-protocol";

export interface Toast {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  ts: string;
}

export interface AgentState {
  nodes: UINode[];
  byKey: Map<string, number>; // key → index in nodes[]
  toasts: Toast[];
  navigate: { href: string; replace?: boolean } | null;
}

export function createInitialAgentState(): AgentState {
  return {
    nodes: [],
    byKey: new Map(),
    toasts: [],
    navigate: null,
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

export type AgentAction = UIEvent | AgentResetAction;

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
  // Drop oldest toasts when limit exceeded
  return { ...state, toasts: toasts.length > MAX_TOASTS ? toasts.slice(-MAX_TOASTS) : toasts };
}

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
      // Stance: reset is always a full clear — nodes, toasts, AND navigate.
      // Pending navigates are stale intent ("go to /foo" issued by a prior
      // turn); after a reset we're starting over and shouldn't fire them.
      // Stance: always return a fresh reference, even when state is already
      // empty. Simpler invariant for consumers (no equality check needed),
      // and the cost is one allocation per reset call.
      return createInitialAgentState();
    default:
      return state;
  }
}
