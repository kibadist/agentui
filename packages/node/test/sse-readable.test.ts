import { describe, it, expect } from "vitest";
import { createAgentReadable } from "../src/sse-readable.js";

describe("createAgentReadable", () => {
  it("returns a ReadableStream that emits framed events", async () => {
    const { readable, stream } = createAgentReadable({
      sessionId: "s1",
      heartbeatMs: 0,
    });

    const decoder = new TextDecoder();
    const reader = readable.getReader();
    const collected: string[] = [];

    const collect = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        collected.push(decoder.decode(value, { stream: true }));
      }
    })();

    await stream.emit({ op: "ui.toast", level: "info", message: "a" });
    await stream.emit({ op: "ui.toast", level: "info", message: "b" });
    await stream.emit({ op: "ui.toast", level: "info", message: "c" });
    await stream.close();
    await collect;

    const joined = collected.join("");
    const frames = joined.split("\n\n").filter(Boolean);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatch(/^id: [0-9a-f-]+\ndata: \{.*"message":"a".*\}$/);
  });

  it("closed flips when the consumer cancels the readable", async () => {
    const { readable, stream } = createAgentReadable({
      sessionId: "s1",
      heartbeatMs: 0,
    });
    const reader = readable.getReader();
    await reader.cancel();
    // Best-effort: emit after cancel becomes a no-op and resolves.
    await stream.emit({ op: "ui.toast", level: "info", message: "ignored" });
    expect(stream.closed).toBe(true);
  });
});
