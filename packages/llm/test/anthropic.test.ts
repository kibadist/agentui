import { describe, it, expect } from "vitest";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { fromAnthropic } from "../src/anthropic.js";

async function* toStream<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

const sessionId = "s1";
const textKey = "tb-1";

describe("fromAnthropic — text streaming", () => {
  it("first text delta → ui.append; subsequent → ui.replace accumulating", async () => {
    const fixture = [
      { type: "message_start", message: { id: "msg_1", role: "assistant", content: [], model: "x", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ];

    const events: AgentWireEvent[] = await collect(
      fromAnthropic(toStream(fixture) as AsyncIterable<never>, { sessionId, textKey }),
    );

    expect(events).toHaveLength(2);
    expect(events[0].op).toBe("ui.append");
    if (events[0].op === "ui.append") {
      expect(events[0].node).toMatchObject({
        key: textKey,
        type: "text-block",
        props: { text: "Hello" },
      });
    }
    expect(events[1].op).toBe("ui.replace");
    if (events[1].op === "ui.replace") {
      expect(events[1].key).toBe(textKey);
      expect(events[1].props).toEqual({ text: "Hello world" });
    }
  });
});

describe("fromAnthropic — tool calls", () => {
  it("tool_use block → tool.start with name + tool.args-delta on input_json_delta", async () => {
    const fixture = [
      { type: "message_start", message: { id: "msg_2", role: "assistant", content: [], model: "x", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "search", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "\"hi\"}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ];

    const events: AgentWireEvent[] = await collect(
      fromAnthropic(toStream(fixture) as AsyncIterable<never>, { sessionId }),
    );

    expect(events[0].op).toBe("tool.start");
    if (events[0].op === "tool.start") {
      expect(events[0].id).toBe("toolu_1");
      expect(events[0].name).toBe("search");
    }
    expect(events[1].op).toBe("tool.args-delta");
    if (events[1].op === "tool.args-delta") {
      expect(events[1].id).toBe("toolu_1");
      expect(events[1].delta).toBe('{"q":');
    }
    expect(events[2].op).toBe("tool.args-delta");
    if (events[2].op === "tool.args-delta") {
      expect(events[2].delta).toBe('"hi"}');
    }
  });
});

describe("fromAnthropic — reasoning (thinking) blocks", () => {
  it("thinking block → reasoning.start / .delta / .end", async () => {
    const fixture = [
      { type: "message_start", message: { id: "msg_3", role: "assistant", content: [], model: "x", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think." } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " More." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_stop" },
    ];

    const events: AgentWireEvent[] = await collect(
      fromAnthropic(toStream(fixture) as AsyncIterable<never>, { sessionId }),
    );

    expect(events[0].op).toBe("reasoning.start");
    expect(events[1].op).toBe("reasoning.delta");
    if (events[1].op === "reasoning.delta") {
      expect(events[1].delta).toBe("Let me think.");
    }
    expect(events[2].op).toBe("reasoning.delta");
    if (events[2].op === "reasoning.delta") {
      expect(events[2].delta).toBe(" More.");
    }
    expect(events[3].op).toBe("reasoning.end");
  });
});

describe("fromAnthropic — stream error", () => {
  it("error mid-stream → final event is ui.toast with level: error", async () => {
    async function* errorStream(): AsyncIterable<unknown> {
      yield { type: "message_start", message: { id: "m", role: "assistant", content: [], model: "x", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } };
      throw new Error("network blip");
    }
    const events: AgentWireEvent[] = await collect(
      fromAnthropic(errorStream() as AsyncIterable<never>, { sessionId }),
    );
    const last = events.at(-1);
    expect(last?.op).toBe("ui.toast");
    if (last?.op === "ui.toast") {
      expect(last.level).toBe("error");
      expect(last.message).toContain("network blip");
    }
  });
});
