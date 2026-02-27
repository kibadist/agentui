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

export const initialAgentState: AgentState = {
  nodes: [],
  byKey: new Map(),
  toasts: [],
  navigate: null,
};

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

function applyToast(state: AgentState, e: UIToastEvent): AgentState {
  const toast: Toast = { id: e.id, level: e.level, message: e.message, ts: e.ts };
  return { ...state, toasts: [...state.toasts, toast] };
}

export function agentReducer(state: AgentState, event: UIEvent): AgentState {
  switch (event.op) {
    case "ui.append":
      return applyAppend(state, event);
    case "ui.replace":
      return applyReplace(state, event);
    case "ui.remove":
      return applyRemove(state, event);
    case "ui.toast":
      return applyToast(state, event);
    case "ui.navigate":
      return { ...state, navigate: { href: event.href, replace: event.replace } };
    default:
      return state;
  }
}
