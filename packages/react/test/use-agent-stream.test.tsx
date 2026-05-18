import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { UIAppendEvent } from "@kibadist/agentui-protocol";

class MockEventSource {
  static instances: MockEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState = MockEventSource.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate "connected" immediately so status flips to "open".
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

beforeEach(() => {
  MockEventSource.instances.length = 0;
  // @ts-expect-error — replacing global for the test
  globalThis.EventSource = MockEventSource;
  // jsdom doesn't define these constants on its (absent) EventSource.
  (globalThis.EventSource as unknown as { CLOSED: number }).CLOSED =
    MockEventSource.CLOSED;
});

afterEach(() => {
  // @ts-expect-error
  delete globalThis.EventSource;
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

// Import after the mock is wired so the hook closes over MockEventSource.
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

  it("reset() clears state but does NOT close the EventSource", async () => {
    const { useAgentStream } = await loadHook();
    const { result } = renderHook(() =>
      useAgentStream({ url: "/sse", sessionId: "s1" }),
    );

    act(() => {
      result.current.dispatch(appendEvent("a"));
    });
    expect(result.current.state.nodes).toHaveLength(1);

    const es = MockEventSource.instances[0];
    expect(es.close).not.toHaveBeenCalled();

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.nodes).toEqual([]);
    expect(result.current.state.byKey.size).toBe(0);
    expect(es.close).not.toHaveBeenCalled();
    expect(es.readyState).toBe(MockEventSource.OPEN);
  });

  it("interleave: append → reset → append yields one node (not two)", async () => {
    // This is the regression anchor for the offset-workaround pattern.
    // If reset state leaks across resets (shared Map ref), the second append
    // would land in a Map that still contains "a", or "b" would land at the
    // wrong index. Both variants of this bug used to require the consumer
    // to track agentNodeOffset.
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

    const es = MockEventSource.instances[0];
    act(() => {
      es.emit({
        v: 1,
        id: "r",
        ts: "2026-01-01T00:00:00Z",
        sessionId: "s1",
        op: "ui.reset",
      });
    });

    expect(result.current.state.nodes).toEqual([]);
    expect(es.close).not.toHaveBeenCalled();
  });
});
