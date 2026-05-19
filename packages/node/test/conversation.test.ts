import { describe, it, expect, vi } from "vitest";
import { Conversation, MemoryConversationStorage } from "../src/index.js";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";

function makeEvent(i: number, ts: string): AgentWireEvent {
  return {
    v: 1,
    id: `e${i}`,
    ts,
    sessionId: "s1",
    op: "ui.toast",
    level: "info",
    message: `m${i}`,
  };
}

describe("Conversation + MemoryConversationStorage", () => {
  it("append + history returns events in chronological order", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    for (let i = 0; i < 5; i++) {
      await conv.append("s1", makeEvent(i, `2026-05-19T00:00:0${i}.000Z`));
    }
    const hist = await conv.history("s1");
    expect(hist).toHaveLength(5);
    expect(hist.map((e) => (e as { id: string }).id)).toEqual(["e0", "e1", "e2", "e3", "e4"]);
  });

  it("limit caps result", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    for (let i = 0; i < 5; i++) {
      await conv.append("s1", makeEvent(i, `2026-05-19T00:00:0${i}.000Z`));
    }
    const hist = await conv.history("s1", { limit: 3 });
    expect(hist).toHaveLength(3);
    expect(hist.map((e) => (e as { id: string }).id)).toEqual(["e0", "e1", "e2"]);
  });

  it("before filters events with ts >= before", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    for (let i = 0; i < 5; i++) {
      await conv.append("s1", makeEvent(i, `2026-05-19T00:00:0${i}.000Z`));
    }
    const hist = await conv.history("s1", { before: "2026-05-19T00:00:03.000Z" });
    expect(hist.map((e) => (e as { id: string }).id)).toEqual(["e0", "e1", "e2"]);
  });

  it("history is empty for unknown session", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    expect(await conv.history("nope")).toEqual([]);
  });

  it("onConversationAppended fires once per append in order", async () => {
    const hook = vi.fn();
    const conv = new Conversation({
      storage: new MemoryConversationStorage(),
      onConversationAppended: hook,
    });
    await conv.append("s1", makeEvent(0, "2026-05-19T00:00:00.000Z"));
    await conv.append("s1", makeEvent(1, "2026-05-19T00:00:01.000Z"));
    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook.mock.calls[0][0]).toBe("s1");
    expect((hook.mock.calls[0][1] as { id: string }).id).toBe("e0");
    expect((hook.mock.calls[1][1] as { id: string }).id).toBe("e1");
  });
});
