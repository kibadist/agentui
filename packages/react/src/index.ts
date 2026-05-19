export { createRegistry } from "./registry.js";
export type { ComponentSpec, Registry } from "./registry.js";

/**
 * Wire protocol event types — re-exported from `@kibadist/agentui-protocol`
 * so consumers can type `onEvent` callbacks and dispatch values without
 * depending on the protocol package directly.
 *
 * @example
 * useAgentStream({
 *   url,
 *   sessionId,
 *   onEvent: (event: UIEvent) => {
 *     switch (event.op) {
 *       case "ui.append":   // event is UIAppendEvent
 *       case "ui.replace":  // event is UIReplaceEvent
 *       // ...
 *     }
 *   },
 * });
 */
export type {
  UIEvent,
  UINode,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
  UINavigateEvent,
  UIResetEvent,
  ToolEvent,
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ToolCallResultEvent,
  ToolCallCancelEvent,
  ReasoningEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  OptimisticEvent,
  OptimisticApplyEvent,
  OptimisticConfirmEvent,
  OptimisticRollbackEvent,
} from "@kibadist/agentui-protocol";

export { agentReducer, initialAgentState, createInitialAgentState } from "./reducer.js";
export type { AgentState, AgentAction, AgentResetAction, ToolCall, ReasoningSegment, OptimisticEntry, Toast } from "./reducer.js";

export { createAgentStore } from "./store.js";
export type { AgentStore, ActionListener } from "./store.js";

export { AgentStateProvider } from "./agent-state-context.js";
export type { AgentStateProviderProps } from "./agent-state-context.js";

export {
  useAgentSelector,
  useAgentNodes,
  useAgentToasts,
  useAgentNavigate,
  useToolCalls,
  useToolCall,
  useReasoning,
  useLatestReasoning,
  useOptimistic,
  useOptimisticAll,
} from "./selectors.js";

export { AgentRenderer } from "./renderer.js";
export type { AgentRendererProps } from "./renderer.js";
export { ToolCallStream } from "./tool-call-stream.js";
export type { ToolCallStreamProps } from "./tool-call-stream.js";

export {
  AgentActionContext,
  AgentActionProvider,
  useAgentAction,
} from "./action-context.js";
export type { ActionSender } from "./action-context.js";

export { useAgentStream } from "./use-agent-stream.js";
export type {
  StreamStatus,
  UseAgentStreamOptions,
  UseAgentStreamResult,
} from "./use-agent-stream.js";

export { AgentRuntimeProvider } from "./runtime-provider.js";
export type { AgentRuntimeProviderProps } from "./runtime-provider.js";

export { AgentRoot } from "./agent-root.js";
export type { AgentRootProps } from "./agent-root.js";

export {
  AgentRootRegistry,
  resolveAgentRoot,
  useAgentRootRegistryEntry,
} from "./agent-root-registry.js";
export type { AgentRootRegistryEntry } from "./agent-root-registry.js";

export { SessionProvider, useAgentSession } from "./session-context.js";
export type { UseAgentSessionResult } from "./session-context.js";

export { localStorageAdapter } from "./storage-adapter.js";
export type { SessionStorageAdapter } from "./storage-adapter.js";

export type { AgentError } from "./agent-error.js";

export type { SessionMetaEvent } from "@kibadist/agentui-protocol";

export { useAgentHistory } from "./use-agent-history.js";
export type { HistoryMessage, UseAgentHistoryResult } from "./use-agent-history.js";
