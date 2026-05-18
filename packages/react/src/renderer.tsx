"use client";

import { Component, createElement, Fragment, type ReactNode } from "react";
import type { UINode } from "@kibadist/agentui-protocol";
import type { Registry } from "./registry.js";
import type { AgentState } from "./reducer.js";

interface NodeErrorBoundaryProps {
  fallback: (err: Error) => ReactNode;
  children?: ReactNode;
}
interface NodeErrorBoundaryState {
  error: Error | null;
}
class NodeErrorBoundary extends Component<
  NodeErrorBoundaryProps,
  NodeErrorBoundaryState
> {
  state: NodeErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): NodeErrorBoundaryState {
    return { error };
  }
  render(): ReactNode {
    return this.state.error
      ? this.props.fallback(this.state.error)
      : this.props.children;
  }
}

export interface AgentRendererProps {
  state: AgentState;
  registry: Registry;
  /** Only render nodes matching this slot (undefined = all). */
  slot?: string;
  /** Rendered when a node type is not in the registry. */
  fallback?: (node: UINode) => ReactNode;
  /** Half-open slice over the post-slot list. Missing bounds default to 0 / length. */
  range?: { start?: number; end?: number };
  /**
   * Predicate run after range. Receives the node and its index in the
   * post-slot (pre-range) array — stable as `range` changes.
   */
  filter?: (node: UINode, index: number) => boolean;
  /** Convenience exclusion set. Applied last; cannot be bypassed by `filter`. */
  hiddenTypes?: ReadonlyArray<string>;
  /**
   * If set, each rendered node is wrapped in an internal error boundary
   * that invokes this on a render error. If omitted, errors propagate
   * (current behavior — no boundary, no reconciliation overhead).
   */
  errorFallback?: (err: Error, node: UINode) => ReactNode;
  /**
   * Wraps each rendered node. Useful for `<AnimatePresence>`-style mount/unmount
   * tracking. The wrapper is the outermost layer per node (sits outside the
   * error boundary), so it remains mounted even if the inner component throws.
   */
  nodeWrapper?: (node: UINode, children: ReactNode) => ReactNode;
}

export function AgentRenderer({
  state,
  registry,
  slot,
  fallback,
  range,
  filter,
  hiddenTypes,
  errorFallback,
  nodeWrapper,
}: AgentRendererProps) {
  const slotted = slot ? state.nodes.filter((n) => n.slot === slot) : state.nodes;
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min(slotted.length, range?.end ?? slotted.length);

  const hiddenSet =
    hiddenTypes && hiddenTypes.length > 0 ? new Set(hiddenTypes) : null;

  const rendered: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    const node = slotted[i];
    if (filter && !filter(node, i)) continue;
    if (hiddenSet && hiddenSet.has(node.type)) continue;
    const el = renderOne(node, registry, fallback);
    if (el === null) continue;
    const guarded = errorFallback
      ? createElement(
          NodeErrorBoundary,
          { fallback: (err: Error) => errorFallback(err, node) },
          el,
        )
      : el;

    const wrapped = nodeWrapper ? nodeWrapper(node, guarded) : guarded;

    rendered.push(createElement(Fragment, { key: node.key }, wrapped));
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
