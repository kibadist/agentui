import { agentReducer, createInitialAgentState, type AgentAction, type AgentResetAction, type AgentState } from "../reducer.js";

/** Every AgentAction except the synthetic `__reset__` — the events you can record and replay. */
export type ReplayableEvent = Exclude<AgentAction, AgentResetAction>;

/** Run a single ReplayableEvent through `agentReducer`. Pure — returns a new state. */
export function pushEvent(state: AgentState, event: ReplayableEvent): AgentState {
  return agentReducer(state, event);
}

/** Fold `agentReducer` over a sequence, starting from a fresh initial state. */
export function replayConversation(events: ReplayableEvent[]): AgentState {
  let state = createInitialAgentState();
  for (const event of events) {
    state = agentReducer(state, event);
  }
  return state;
}
