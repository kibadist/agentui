import { describe, it, expect } from "vitest";
import { createAgentStream, emitTextStream, emitToolCall } from "../src/index.js";

function makeRes() {
  return {
    headers: {} as Record<string, string>,
    chunks: [] as string[],
    writeHead(_s: number, h: Record<string, string>) {
      this.headers = h;
    },
    write(c: string) {
      this.chunks.push(c);
      return true;
    },
    end() {},
    on() {},
    destroyed: false,
  };
}

function payloads(chunks: string[]) {
  return chunks.map((c) => JSON.parse(c.split("\n")[1].slice("data: ".length)));
}

describe("emitTextStream", () => {
  it("emits start/delta*/end for an async iterable", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    async function* gen() {
      yield "hello";
      yield " ";
      yield "world";
    }
    const reasoningId = await emitTextStream(stream, { chunks: gen() });
    expect(typeof reasoningId).toBe("string");
    const ops = payloads(res.chunks).map((p) => p.op);
    expect(ops).toEqual(["reasoning.start", "reasoning.delta", "reasoning.delta", "reasoning.delta", "reasoning.end"]);
    expect(payloads(res.chunks).every((p) => p.id === reasoningId)).toBe(true);
    expect(payloads(res.chunks)[2].delta).toBe(" ");
  });

  it("emits reasoning.end even if iterable throws, then re-throws", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    async function* gen() {
      yield "a";
      throw new Error("boom");
    }
    await expect(emitTextStream(stream, { chunks: gen() })).rejects.toThrow("boom");
    const ops = payloads(res.chunks).map((p) => p.op);
    expect(ops).toEqual(["reasoning.start", "reasoning.delta", "reasoning.end"]);
  });
});

describe("emitToolCall", () => {
  it("happy path: emits tool.start + tool.result(ok) and returns runner result", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    const result = await emitToolCall(stream, {
      name: "search",
      args: { q: "foo" },
      runner: async () => 42,
    });
    expect(result).toBe(42);
    const events = payloads(res.chunks);
    expect(events.map((e) => e.op)).toEqual(["tool.start", "tool.result"]);
    expect(events[0].name).toBe("search");
    expect(events[0].args).toEqual({ q: "foo" });
    expect(events[1].status).toBe("ok");
    expect(events[1].result).toBe(42);
    expect(events[0].id).toBe(events[1].id);
  });

  it("error path: emits tool.start + tool.result(error) and re-throws", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    await expect(
      emitToolCall(stream, {
        name: "broken",
        args: {},
        runner: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    const events = payloads(res.chunks);
    expect(events.map((e) => e.op)).toEqual(["tool.start", "tool.result"]);
    expect(events[1].status).toBe("error");
    expect(events[1].error.message).toBe("boom");
  });
});
