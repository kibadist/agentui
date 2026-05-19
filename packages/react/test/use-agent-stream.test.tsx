import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { UIAppendEvent } from "@kibadist/agentui-protocol";
import * as sseModule from "../src/sse-transport.js";

type ConnectOpts = Parameters<typeof sseModule.connectSse>[0];

// Per-test queue of opts so tests can push events and errors.
let currentOpts: ConnectOpts | null = null;
let connectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  currentOpts = null;
  connectSpy = vi.spyOn(sseModule, "connectSse").mockImplementation(async (opts) => {
    currentOpts = opts;
    opts.onOpen();
    // Stay open until aborted.
    return new Promise<void>((resolve) => {
      opts.signal.addEventListener("abort", () => resolve());
    });
  });
});

afterEach(() => {
  connectSpy.mockRestore();
});

function appendEvent(key: string): UIAppendEvent {
  return {
    v: 1,
    id: `evt-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.append",
    node: { key, type: "test.node", props: {} },
  };
}

async function loadHook() {
  return await import("../src/use-agent-stream.js");
}

describe("useAgentStream", () => {
  it("dispatch(uiEvent) updates state synchronously through the reducer", async () => {
    const { useAgentStream } = await loadHook();
    const { result } = renderHook(() =>
      useAgentStream({ url: "/sse", sessionId: "s1" }),
    );

    act(() => {
      result.current.dispatch(appendEvent("a"));
    });

    expect(result.current.state.nodes).toHaveLength(1);
    expect(result.current.state.nodes[0].key).toBe("a");
  });

  it("reset() clears state but does NOT close the SSE connection", async () => {
    const { useAgentStream } = await loadHook();
    const { result } = renderHook(() =>
      useAgentStream({ url: "/sse", sessionId: "s1" }),
    );

    act(() => {
      result.current.dispatch(appendEvent("a"));
    });
    expect(result.current.state.nodes).toHaveLength(1);

    // The connection should still be open (connectSpy called once, not aborted).
    expect(connectSpy).toHaveBeenCalledOnce();

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.nodes).toEqual([]);
    expect(result.current.state.byKey.size).toBe(0);
    // Connection still open — signal not aborted.
    expect(currentOpts?.signal.aborted).toBe(false);
  });

  it("interleave: append → reset → append yields one node (not two)", async () => {
    // Regression anchor for the offset-workaround pattern.
    const { useAgentStream } = await loadHook();
    const { result } = renderHook(() =>
      useAgentStream({ url: "/sse", sessionId: "s1" }),
    );

    act(() => {
      result.current.dispatch(appendEvent("a"));
    });
    expect(result.current.state.nodes.map((n) => n.key)).toEqual(["a"]);

    act(() => {
      result.current.reset();
    });
    expect(result.current.state.nodes).toEqual([]);

    act(() => {
      result.current.dispatch(appendEvent("b"));
    });
    expect(result.current.state.nodes.map((n) => n.key)).toEqual(["b"]);
    expect(result.current.state.byKey.get("b")).toBe(0);
    // Key from the previous session must not survive.
    expect(result.current.state.byKey.has("a")).toBe(false);
  });

  it("ui.reset wire event clears state via the message path", async () => {
    const { useAgentStream } = await loadHook();
    const { result } = renderHook(() =>
      useAgentStream({ url: "/sse", sessionId: "s1" }),
    );

    act(() => {
      result.current.dispatch(appendEvent("a"));
    });
    expect(result.current.state.nodes).toHaveLength(1);

    act(() => {
      currentOpts?.onEvent(
        JSON.stringify({
          v: 1,
          id: "r",
          ts: "2026-01-01T00:00:00Z",
          sessionId: "s1",
          op: "ui.reset",
        }),
        undefined,
      );
    });

    expect(result.current.state.nodes).toEqual([]);
    // Connection still open — not aborted by a ui.reset event.
    expect(currentOpts?.signal.aborted).toBe(false);
  });
});
