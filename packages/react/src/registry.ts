import type { ComponentType } from "react";

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
 * Build a `Registry` from a plain object map. Component specs are looked up
 * by their UI-node type string at render time.
 */
export function createRegistry(
  map: Record<string, ComponentSpec>,
): Registry {
  const internal = new Map(Object.entries(map));
  return {
    get: (type) => internal.get(type),
    has: (type) => internal.has(type),
    types: () => [...internal.keys()],
  };
}
