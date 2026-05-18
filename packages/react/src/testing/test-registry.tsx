import { type ComponentType } from "react";
import { createRegistry, type ComponentSpec, type Registry } from "../registry.js";

// Module-scoped cache: same unknown type → same component reference across calls.
// Keeps React reconciliation stable when tests reuse a marker across rerenders.
const markerCache = new Map<string, ComponentType<Record<string, unknown>>>();

function getMarker(type: string): ComponentType<Record<string, unknown>> {
  const cached = markerCache.get(type);
  if (cached) return cached;
  const Marker = (props: Record<string, unknown>) => (
    <span data-testid={`test-marker-${type}`}>{JSON.stringify(props)}</span>
  );
  Marker.displayName = `TestMarker(${type})`;
  markerCache.set(type, Marker);
  return Marker;
}

/**
 * A Registry that stubs missing entries with a marker component rendering
 * `<span data-testid="test-marker-{type}">{JSON.stringify(props)}</span>`.
 * Known types resolve to the supplied component as usual.
 */
export function createTestRegistry(map: Record<string, ComponentSpec>): Registry {
  const base = createRegistry(map);
  return {
    get(type) {
      return base.get(type) ?? { component: getMarker(type) };
    },
    has() {
      return true;
    },
    types() {
      return base.types();
    },
  };
}
