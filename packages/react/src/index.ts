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
} from "@kibadist/agentui-protocol";

export { agentReducer, initialAgentState, createInitialAgentState } from "./reducer.js";
export type { AgentState, AgentAction, AgentResetAction, ToolCall, Toast } from "./reducer.js";

export { createAgentStore } from "./store.js";
export type { AgentStore } from "./store.js";

export { AgentStateProvider } from "./agent-state-context.js";
export type { AgentStateProviderProps } from "./agent-state-context.js";

export {
  useAgentSelector,
  useAgentNodes,
  useAgentToasts,
  useAgentNavigate,
  useToolCalls,
  useToolCall,
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
