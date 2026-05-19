"use client";

import { createContext, useContext } from "react";
import type { ActionSender } from "./action-context.js";
import type { AgentStore } from "./store.js";
import type { AgentRootConfig, UseAgentSessionResult } from "./session-context.js";

/**
 * One entry in the linked list of `<AgentRoot>` instances in the tree.
 * Each `<AgentRoot>` builds its own entry pointing back at its parent.
 * Walk the list via `resolveAgentRoot` to find a specific `id`.
 */
export interface AgentRootRegistryEntry {
  id: string | undefined;
  session: UseAgentSessionResult;
  config: AgentRootConfig;
  store: AgentStore;
  actionSender: ActionSender;
  parent: AgentRootRegistryEntry | null;
}

export const AgentRootRegistry = createContext<AgentRootRegistryEntry | null>(null);

/** Read the nearest registry entry (the deepest `<AgentRoot>` ancestor's). */
export function useAgentRootRegistryEntry(): AgentRootRegistryEntry | null {
  return useContext(AgentRootRegistry);
}

/**
 * Walk the linked list looking for an entry whose `id` matches. With
 * `undefined`, returns the entry itself (nearest, regardless of id).
 * Returns null if no match.
 */
export function resolveAgentRoot(
  entry: AgentRootRegistryEntry | null,
  id: string | undefined,
): AgentRootRegistryEntry | null {
  if (entry === null) return null;
  if (id === undefined) return entry;
  if (entry.id === id) return entry;
  return resolveAgentRoot(entry.parent, id);
}
