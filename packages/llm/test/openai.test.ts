import { describe, it, expect } from "vitest";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { fromOpenAI } from "../src/openai.js";

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

describe("fromOpenAI — text streaming", () => {
  it("first text chunk → ui.append; subsequent → ui.replace", async () => {
    const fixture = [
      { choices: [{ index: 0, delta: { role: "assistant" } }] },
      { choices: [{ index: 0, delta: { content: "Hello" } }] },
      { choices: [{ index: 0, delta: { content: " world" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const events: AgentWireEvent[] = await collect(
      fromOpenAI(toStream(fixture) as AsyncIterable<never>, { sessionId, textKey }),
    );
    expect(events[0].op).toBe("ui.append");
    if (events[0].op === "ui.append") {
      expect(events[0].node.props).toEqual({ text: "Hello" });
    }
    expect(events[1].op).toBe("ui.replace");
    if (events[1].op === "ui.replace") {
      expect(events[1].props).toEqual({ text: "Hello world" });
    }
  });
});

describe("fromOpenAI — tool calls", () => {
  it("first tool_call chunk → tool.start; subsequent → tool.args-delta", async () => {
    const fixture = [
      { choices: [{ index: 0, delta: { role: "assistant" } }] },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_abc", function: { name: "search", arguments: "" } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"q":' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }],
            },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const events: AgentWireEvent[] = await collect(
      fromOpenAI(toStream(fixture) as AsyncIterable<never>, { sessionId }),
    );
    expect(events[0].op).toBe("tool.start");
    if (events[0].op === "tool.start") {
      expect(events[0].id).toBe("call_abc");
      expect(events[0].name).toBe("search");
    }
    const argsDeltas = events.filter((e) => e.op === "tool.args-delta");
    expect(argsDeltas).toHaveLength(2);
    if (argsDeltas[0].op === "tool.args-delta") {
      expect(argsDeltas[0].delta).toBe('{"q":');
    }
    if (argsDeltas[1].op === "tool.args-delta") {
      expect(argsDeltas[1].delta).toBe('"hi"}');
    }
  });
});

describe("fromOpenAI — stream error", () => {
  it("error mid-stream → final event is ui.toast (error)", async () => {
    async function* errorStream(): AsyncIterable<unknown> {
      yield { choices: [{ index: 0, delta: { content: "x" } }] };
      throw new Error("boom");
    }
    const events: AgentWireEvent[] = await collect(
      fromOpenAI(errorStream() as AsyncIterable<never>, { sessionId }),
    );
    const last = events.at(-1);
    expect(last?.op).toBe("ui.toast");
    if (last?.op === "ui.toast") {
      expect(last.level).toBe("error");
      expect(last.message).toContain("boom");
    }
  });
});
