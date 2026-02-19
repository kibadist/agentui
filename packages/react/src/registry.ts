import type { ComponentType } from "react";

/** Minimal Zod-compatible schema shape (avoids hard dep on zod) */
interface ZodLike<T = any> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

export interface ComponentSpec<P = any> {
  component: ComponentType<P>;
  /** Optional Zod schema for runtime prop validation */
  propsSchema?: ZodLike<P>;
  /** Capability requirements at the component level */
  requires?: string[];
}

export interface Registry {
  get(type: string): ComponentSpec | undefined;
  has(type: string): boolean;
  types(): string[];
}

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
