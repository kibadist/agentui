import { agentReducer, createInitialAgentState, type AgentState } from "../reducer.js";
import type { UIEvent } from "@kibadist/agentui-protocol";

/** Run a single UIEvent through `agentReducer`. Pure — returns a new state. */
export function pushEvent(state: AgentState, event: UIEvent): AgentState {
  return agentReducer(state, event);
}

/** Fold `agentReducer` over a sequence, starting from a fresh initial state. */
export function replayConversation(events: UIEvent[]): AgentState {
  let state = createInitialAgentState();
  for (const event of events) {
    state = agentReducer(state, event);
  }
  return state;
}
