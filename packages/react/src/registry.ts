import type { ComponentType } from "react";
import type { NodeDefinition } from "./define-node.js";

/** Minimal Zod-compatible schema shape (avoids hard dep on zod) */
interface ZodLike<T = any> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

/** Describes how a typed UI node maps to a rendered React component. */
export interface ComponentSpec<P = any> {
  component: ComponentType<P>;
  /** Optional Zod schema for runtime prop validation */
  propsSchema?: ZodLike<P>;
  /** Capability requirements at the component level */
  requires?: string[];
}

/**
 * A whitelisted lookup of UI node types to their rendered component specs.
 * Build one with {@link createRegistry}.
 */
export interface Registry {
  get(type: string): ComponentSpec | undefined;
  has(type: string): boolean;
  types(): string[];
}

/**
 * Build a `Registry`. Accepts either:
 * - a plain object map keyed by node type (legacy)
 * - an array of `NodeDefinition`s from `defineNode()` (schema-first)
 *
 * Both forms produce identical `Registry` behavior.
 */
export function createRegistry(map: Record<string, ComponentSpec>): Registry;
export function createRegistry(nodes: NodeDefinition<any>[]): Registry;
export function createRegistry(
  input: Record<string, ComponentSpec> | NodeDefinition<any>[],
): Registry {
  const internal = new Map<string, ComponentSpec>();

  if (Array.isArray(input)) {
    for (const node of input) {
      if (internal.has(node.type)) {
        throw new Error(`createRegistry: duplicate node type "${node.type}"`);
      }
      internal.set(node.type, nodeDefinitionToSpec(node));
    }
  } else {
    for (const [type, spec] of Object.entries(input)) {
      internal.set(type, spec);
    }
  }

  return {
    get: (type) => internal.get(type),
    has: (type) => internal.has(type),
    types: () => [...internal.keys()],
  };
}

function nodeDefinitionToSpec(node: NodeDefinition<any>): ComponentSpec {
  const spec: ComponentSpec = {
    component: node.component,
    propsSchema: node.schema as unknown as ZodLike,
  };
  if (node.requires !== undefined) {
    spec.requires = [...node.requires];
  }
  return spec;
}
