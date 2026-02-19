import { createElement, type ReactNode } from "react";
import type { UINode } from "@agentui/protocol";
import type { Registry } from "./registry.js";
import type { AgentState } from "./reducer.js";

export interface AgentRendererProps {
  state: AgentState;
  registry: Registry;
  /** Only render nodes matching this slot (undefined = all) */
  slot?: string;
  /** Rendered when a node type is not in the registry */
  fallback?: (node: UINode) => ReactNode;
}

export function AgentRenderer({ state, registry, slot, fallback }: AgentRendererProps) {
  const filtered = slot ? state.nodes.filter((n) => n.slot === slot) : state.nodes;

  return (
    <>
      {filtered.map((node) => {
        const spec = registry.get(node.type);
        if (!spec) {
          if (fallback) return <span key={node.key}>{fallback(node)}</span>;
          if (typeof globalThis !== "undefined" && (globalThis as any).__DEV__ !== false) {
            console.warn(`[agentui] Unknown component type: "${node.type}"`);
          }
          return null;
        }

        // Optional runtime prop validation
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

        return createElement(spec.component, { key: node.key, ...node.props });
      })}
    </>
  );
}
