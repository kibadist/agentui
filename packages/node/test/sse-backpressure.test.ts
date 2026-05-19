import { describe, it, expect } from "vitest";
import { createAgentStream } from "../src/sse-writer.js";

describe("createAgentStream — backpressure", () => {
  it("awaits 'drain' when write returns false; preserves FIFO", async () => {
    const drainListeners: Array<() => void> = [];
    let writeCount = 0;
    const res = {
      writeHead: () => {},
      write(_chunk: string) {
        writeCount++;
        // Pretend the first event hits a full buffer; subsequent writes succeed.
        return writeCount > 1;
      },
      end: () => {},
      on(event: string, cb: () => void) {
        if (event === "drain") drainListeners.push(cb);
      },
      destroyed: false,
    };

    const stream = createAgentStream(res as unknown as Parameters<typeof createAgentStream>[0], {
      sessionId: "s1",
      heartbeatMs: 0,
    });

    const order: string[] = [];
    const p1 = stream.emit({ op: "ui.toast", level: "info", message: "a" }).then(() => order.push("a"));
    const p2 = stream.emit({ op: "ui.toast", level: "info", message: "b" }).then(() => order.push("b"));

    // p1 is parked on drain — release it.
    await Promise.resolve(); // let microtasks run
    await Promise.resolve();
    expect(drainListeners.length).toBeGreaterThan(0);
    drainListeners.forEach((cb) => cb());

    await Promise.all([p1, p2]);
    expect(order).toEqual(["a", "b"]);
  });
});
