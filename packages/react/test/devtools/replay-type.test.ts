import { describe, it, expect } from "vitest";
import { replayConversation, type ReplayableEvent } from "../../src/testing/replay.js";
import type { ToolCallStartEvent, ToolArgsDeltaEvent } from "@kibadist/agentui-protocol";

describe("replayConversation accepts the full AgentAction union (minus __reset__)", () => {
  it("folds tool.start + tool.args-delta into toolCalls state", () => {
    const toolStartEvent: ToolCallStartEvent = {
      v: 1,
      id: "tool-call-1",
      ts: "2025-05-19T00:00:00Z",
      sessionId: "session-1",
      op: "tool.start",
      name: "search_users",
      args: { limit: 10 },
    };

    const toolDeltaEvent: ToolArgsDeltaEvent = {
      v: 1,
      id: "tool-call-1",
      ts: "2025-05-19T00:00:01Z",
      sessionId: "session-1",
      op: "tool.args-delta",
      delta: '{"offset":5}',
    };

    const events: ReplayableEvent[] = [toolStartEvent, toolDeltaEvent];
    const state = replayConversation(events);

    expect(state.toolCalls.size).toBe(1);
    const toolCall = state.toolCalls.get("tool-call-1");
    expect(toolCall).toBeDefined();
    expect(toolCall?.name).toBe("search_users");
    expect(toolCall?.argsRaw).toContain("limit");
    expect(toolCall?.argsRaw).toContain("offset");
  });
});
