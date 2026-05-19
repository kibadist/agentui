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

  it("before filters events with ts >= before (event whose ts equals cutoff is excluded)", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    for (let i = 0; i < 5; i++) {
      await conv.append("s1", makeEvent(i, `2026-05-19T00:00:0${i}.000Z`));
    }
    // e3.ts === before — must be excluded (strict `<` semantics).
    const hist = await conv.history("s1", { before: "2026-05-19T00:00:03.000Z" });
    expect(hist.map((e) => (e as { id: string }).id)).toEqual(["e0", "e1", "e2"]);
  });

  it("before compares timestamps chronologically across timezone formats", async () => {
    const conv = new Conversation({ storage: new MemoryConversationStorage() });
    // 12:00 UTC, same instant expressed as +03:00 offset, then 15:00 UTC.
    await conv.append("s1", makeEvent(0, "2026-05-19T12:00:00.000Z"));
    await conv.append("s1", makeEvent(1, "2026-05-19T15:00:00.000+03:00")); // same instant as 12:00 UTC
    await conv.append("s1", makeEvent(2, "2026-05-19T15:00:00.000Z"));
    // Cutoff is 13:00 UTC expressed as +03:00 offset. e0 and e1 are both at
    // 12:00 UTC, so both should be excluded (strict `<`) — wait, included.
    // 12:00 UTC < 13:00 UTC, so both included. e2 (15:00 UTC) excluded.
    const hist = await conv.history("s1", { before: "2026-05-19T16:00:00.000+03:00" });
    expect(hist.map((e) => (e as { id: string }).id)).toEqual(["e0", "e1"]);
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
