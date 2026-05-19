import { describe, it, expect, vi } from "vitest";
import { createAgentStream } from "../src/sse-writer.js";

interface MockRes {
  headers: Record<string, string>;
  status: number;
  chunks: string[];
  ended: boolean;
  destroyed: boolean;
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: string): boolean;
  end(): void;
  on(event: string, cb: () => void): void;
}

function makeRes(): MockRes {
  return {
    headers: {},
    status: 0,
    chunks: [],
    ended: false,
    destroyed: false,
    writeHead(s, h) {
      this.status = s;
      this.headers = { ...h };
    },
    write(c) {
      this.chunks.push(c);
      return true;
    },
    end() {
      this.ended = true;
    },
    on() {},
  };
}

describe("createAgentStream — wire format", () => {
  it("writes headers on first emit and frames the event correctly", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });

    await stream.emit({
      op: "ui.append",
      node: { key: "k1", type: "x.y", props: {} },
    });

    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.headers["Cache-Control"]).toBe("no-cache, no-transform");
    expect(res.headers["Connection"]).toBe("keep-alive");

    expect(res.chunks).toHaveLength(1);
    const frame = res.chunks[0];
    expect(frame).toMatch(/^id: [0-9a-f-]{36}\ndata: \{.*\}\n\n$/);

    const dataLine = frame.split("\n")[1];
    const payload = JSON.parse(dataLine.slice("data: ".length));
    expect(payload.v).toBe(1);
    expect(payload.op).toBe("ui.append");
    expect(payload.sessionId).toBe("s1");
    expect(typeof payload.ts).toBe("string");
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.node).toEqual({ key: "k1", type: "x.y", props: {} });
  });

  it("emits 10 events as 10 frames", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    for (let i = 0; i < 10; i++) {
      await stream.emit({
        op: "ui.append",
        node: { key: `k${i}`, type: "x.y", props: { i } },
      });
    }
    expect(res.chunks).toHaveLength(10);
    expect(res.chunks.every((c) => c.endsWith("\n\n"))).toBe(true);
  });

  it("respects caller-supplied id/ts overrides", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    await stream.emit({
      op: "ui.toast",
      id: "fixed-id",
      ts: "2026-05-19T00:00:00.000Z",
      level: "info",
      message: "hello",
    });
    const payload = JSON.parse(res.chunks[0].split("\n")[1].slice(6));
    expect(payload.id).toBe("fixed-id");
    expect(payload.ts).toBe("2026-05-19T00:00:00.000Z");
  });

  it("close() ends the response and sets closed=true", async () => {
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });
    await stream.close();
    expect(res.ended).toBe(true);
    expect(stream.closed).toBe(true);
  });

  it("onEventEmitted hook fires per event", async () => {
    const res = makeRes();
    const hook = vi.fn();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
      onEventEmitted: hook,
    });
    await stream.emit({ op: "ui.toast", level: "info", message: "x" });
    await stream.emit({ op: "ui.toast", level: "info", message: "y" });
    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook.mock.calls[0][0].op).toBe("ui.toast");
    expect(hook.mock.calls[1][0].message).toBe("y");
  });

  it("forwards emitted events to attached Conversation", async () => {
    const conv = new (await import("../src/index.js")).Conversation({
      storage: new (await import("../src/index.js")).MemoryConversationStorage(),
    });
    const res = makeRes();
    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
      conversation: conv,
    });
    await stream.emit({ op: "ui.toast", level: "info", message: "x" });
    await stream.emit({ op: "ui.toast", level: "info", message: "y" });
    const hist = await conv.history("s1");
    expect(hist).toHaveLength(2);
  });
});
