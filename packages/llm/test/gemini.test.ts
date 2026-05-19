import { describe, it, expect } from "vitest";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { fromGemini } from "../src/gemini.js";

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

describe("fromGemini — text streaming", () => {
  it("first chunk with text → ui.append; subsequent text chunks → ui.replace", async () => {
    const fixture = [
      { candidates: [{ content: { parts: [{ text: "Hello" }] } }] },
      { candidates: [{ content: { parts: [{ text: "Hello world" }] } }] },
      { candidates: [{ finishReason: "STOP" }] },
    ];
    const events: AgentWireEvent[] = await collect(
      fromGemini(toStream(fixture) as AsyncIterable<never>, { sessionId, textKey }),
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

describe("fromGemini — function calls", () => {
  it("functionCall part → tool.start with complete args (no args-delta)", async () => {
    const fixture = [
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "search",
                    args: { q: "hi" },
                  },
                },
              ],
            },
          },
        ],
      },
      { candidates: [{ finishReason: "STOP" }] },
    ];
    const events: AgentWireEvent[] = await collect(
      fromGemini(toStream(fixture) as AsyncIterable<never>, { sessionId }),
    );
    const toolStart = events.find((e) => e.op === "tool.start");
    expect(toolStart).toBeDefined();
    if (toolStart?.op === "tool.start") {
      expect(toolStart.name).toBe("search");
      expect(toolStart.args).toEqual({ q: "hi" });
    }
    expect(events.some((e) => e.op === "tool.args-delta")).toBe(false);
  });
});

describe("fromGemini — stream error", () => {
  it("error mid-stream → final event is ui.toast (error)", async () => {
    async function* errorStream(): AsyncIterable<unknown> {
      yield { candidates: [{ content: { parts: [{ text: "x" }] } }] };
      throw new Error("boom");
    }
    const events: AgentWireEvent[] = await collect(
      fromGemini(errorStream() as AsyncIterable<never>, { sessionId }),
    );
    const last = events.at(-1);
    expect(last?.op).toBe("ui.toast");
    if (last?.op === "ui.toast") {
      expect(last.message).toContain("boom");
    }
  });
});
