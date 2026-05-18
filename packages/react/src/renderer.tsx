import { createElement, Fragment, type ReactNode } from "react";
import type { UINode } from "@kibadist/agentui-protocol";
import type { Registry } from "./registry.js";
import type { AgentState } from "./reducer.js";

export interface AgentRendererProps {
  state: AgentState;
  registry: Registry;
  /** Only render nodes matching this slot (undefined = all). */
  slot?: string;
  /** Rendered when a node type is not in the registry. */
  fallback?: (node: UINode) => ReactNode;
  /** Half-open slice over the post-slot list. Missing bounds default to 0 / length. */
  range?: { start?: number; end?: number };
}

export function AgentRenderer({
  state,
  registry,
  slot,
  fallback,
  range,
}: AgentRendererProps) {
  const slotted = slot ? state.nodes.filter((n) => n.slot === slot) : state.nodes;
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min(slotted.length, range?.end ?? slotted.length);

  const rendered: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    const node = slotted[i];
    const el = renderOne(node, registry, fallback);
    if (el === null) continue;
    rendered.push(createElement(Fragment, { key: node.key }, el));
  }

  return <>{rendered}</>;
}

function renderOne(
  node: UINode,
  registry: Registry,
  fallback: ((node: UINode) => ReactNode) | undefined,
): ReactNode {
  const spec = registry.get(node.type);
  if (!spec) {
    if (fallback) return fallback(node);
    if (typeof globalThis !== "undefined" && (globalThis as any).__DEV__ !== false) {
      console.warn(`[agentui] Unknown component type: "${node.type}"`);
    }
    return null;
  }

  if (spec.propsSchema) {
    const result = spec.propsSchema.safeParse(node.props);
    if (!result.success) {
      if (typeof globalThis !== "undefined" && (globalThis as any).__DEV__ !== false) {
        console.warn(
          `[agentui] Props validation failed for "${node.type}" (key="${node.key}"):`,
          result.error.message,
        );
      }
      return null;
    }
  }

  return createElement(spec.component, node.props);
}
