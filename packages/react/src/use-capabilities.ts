"use client";

import { useMemo } from "react";
import { useAgentSelector } from "./selectors.js";
import type { Capabilities } from "./reducer.js";

export interface UseCapabilitiesResult {
  declared: boolean;
  nodeTypes: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  hasPermission(perm: string): boolean;
  canAct(action: string): boolean;
  canEmit(nodeType: string): boolean;
}

export function useCapabilities(): UseCapabilitiesResult {
  const capabilities = useAgentSelector((s): Capabilities => s.capabilities);
  return useMemo<UseCapabilitiesResult>(
    () => ({
      declared: capabilities.declared,
      nodeTypes: capabilities.nodeTypes,
      actions: capabilities.actions,
      permissions: capabilities.permissions,
      hasPermission: (p) => capabilities.permissions.has(p),
      canAct: (a) => capabilities.actions.has(a),
      canEmit: (t) => capabilities.nodeTypes.has(t),
    }),
    [capabilities],
  );
}
