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

/**
 * Props for {@link AgentRenderer}. Composition order is
 * `slot → range → filter → hiddenTypes`. All optional props default to no-op.
 */
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
  /**
   * Called when a node's `ComponentSpec.requires` lists permissions that are
   * absent from `state.capabilities.permissions`. Only fires after a
   * `session.init` event (`declared === true`). If omitted the node is hidden
   * silently.
   */
  permissionFallback?: (node: UINode, missing: string[]) => ReactNode;
}

/**
 * Render the current `AgentState.nodes` through a whitelisted `Registry`.
 * See {@link AgentRendererProps} for slicing, filtering, error containment,
 * and per-node wrapping hooks.
 */
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
  permissionFallback,
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
    const el = renderOne(node, registry, fallback, state.capabilities, permissionFallback);
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
  capabilities: AgentState["capabilities"],
  permissionFallback: ((node: UINode, missing: string[]) => ReactNode) | undefined,
): ReactNode {
  const spec = registry.get(node.type);
  if (!spec) {
    if (fallback) return fallback(node);
    if (typeof globalThis !== "undefined" && (globalThis as any).__DEV__ !== false) {
      console.warn(`[agentui] Unknown component type: "${node.type}"`);
    }
    return null;
  }

  if (capabilities.declared && spec.requires && spec.requires.length > 0) {
    const missing = spec.requires.filter((p) => !capabilities.permissions.has(p));
    if (missing.length > 0) {
      return permissionFallback ? permissionFallback(node, missing) : null;
    }
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
