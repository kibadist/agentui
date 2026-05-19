import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";
import {
  AgentRoot,
  useAgentNodes,
  useAgentSession,
} from "../src/index.js";
import type { SessionStorageAdapter, UIAppendEvent } from "../src/index.js";

function makeStorage(): SessionStorageAdapter {
  const store = new Map<string, string>();
  return {
    get: (k) => store.get(k) ?? null,
    set: (k, v) => {
      store.set(k, v);
    },
    remove: (k) => {
      store.delete(k);
    },
  };
}

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
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

function makeFetchMock(
  sessionResponses: Record<string, string>,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [endpoint, sessionId] of Object.entries(sessionResponses)) {
      if (url.startsWith(endpoint)) {
        if (url.includes("/session")) {
          return new Response(JSON.stringify({ sessionId }), { status: 200 });
        }
        if (url.includes("/history")) {
          return new Response(JSON.stringify({ messages: [] }), { status: 200 });
        }
      }
    }
    return new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  MockEventSource.instances.length = 0;
  // @ts-expect-error
  globalThis.EventSource = MockEventSource;
  (globalThis.EventSource as unknown as { CLOSED: number }).CLOSED = MockEventSource.CLOSED;
});

afterEach(() => {
  cleanup();
  // @ts-expect-error
  delete globalThis.EventSource;
});

describe("multi-agent namespacing", () => {
  it("two nested roots; scoped hooks resolve to the right one", async () => {
    const fetchMock = makeFetchMock({
      "/api/chat": "ses_chat",
      "/api/planner": "ses_planner",
    });

    function Probe() {
      const chat = useAgentSession("chat");
      const planner = useAgentSession("planner");
      return (
        <>
          <span data-testid="chat-sid">{chat.sessionId ?? ""}</span>
          <span data-testid="planner-sid">{planner.sessionId ?? ""}</span>
        </>
      );
    }

    const { getByTestId } = render(
      <AgentRoot id="chat" endpoint="/api/chat" storage={makeStorage()} fetch={fetchMock}>
        <AgentRoot id="planner" endpoint="/api/planner" storage={makeStorage()} fetch={fetchMock}>
          <Probe />
        </AgentRoot>
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("chat-sid").textContent).toBe("ses_chat");
      expect(getByTestId("planner-sid").textContent).toBe("ses_planner");
    });
  });

  it("hook without id resolves to the nearest root", async () => {
    const fetchMock = makeFetchMock({
      "/api/chat": "ses_chat",
      "/api/planner": "ses_planner",
    });

    function Probe() {
      const nearest = useAgentSession(); // no id
      return <span data-testid="nearest-sid">{nearest.sessionId ?? ""}</span>;
    }

    const { getByTestId } = render(
      <AgentRoot id="chat" endpoint="/api/chat" storage={makeStorage()} fetch={fetchMock}>
        <AgentRoot id="planner" endpoint="/api/planner" storage={makeStorage()} fetch={fetchMock}>
          <Probe />
        </AgentRoot>
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("nearest-sid").textContent).toBe("ses_planner");
    });
  });

  it("hook with unknown id throws", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = makeFetchMock({
      "/api/chat": "ses_chat",
    });

    function Probe() {
      useAgentSession("planner");
      return <span data-testid="probe" />;
    }

    expect(() =>
      render(
        <AgentRoot id="chat" endpoint="/api/chat" storage={makeStorage()} fetch={fetchMock}>
          <Probe />
        </AgentRoot>,
      ),
    ).toThrow(/No <AgentRoot id="planner">/);

    errSpy.mockRestore();
  });

  it("duplicate id at nested AgentRoots throws at mount", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = makeFetchMock({
      "/api/a": "ses_a",
      "/api/b": "ses_b",
    });

    expect(() =>
      render(
        <AgentRoot id="chat" endpoint="/api/a" storage={makeStorage()} fetch={fetchMock}>
          <AgentRoot id="chat" endpoint="/api/b" storage={makeStorage()} fetch={fetchMock}>
            <span />
          </AgentRoot>
        </AgentRoot>,
      ),
    ).toThrow(/Duplicate <AgentRoot id="chat">/);

    errSpy.mockRestore();
  });

  it("useAgentNodes(id) resolves to the right store", async () => {
    const fetchMock = makeFetchMock({
      "/api/chat": "ses_chat",
      "/api/planner": "ses_planner",
    });

    function Probe() {
      const chatNodes = useAgentNodes("chat");
      const plannerNodes = useAgentNodes("planner");
      return (
        <>
          <span data-testid="chat-count">{chatNodes.length}</span>
          <span data-testid="planner-count">{plannerNodes.length}</span>
        </>
      );
    }

    const { getByTestId } = render(
      <AgentRoot id="chat" endpoint="/api/chat" storage={makeStorage()} fetch={fetchMock}>
        <AgentRoot id="planner" endpoint="/api/planner" storage={makeStorage()} fetch={fetchMock}>
          <Probe />
        </AgentRoot>
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBe(2);
    });

    // React runs effects inner → outer, so the inner AgentRoot (planner) creates
    // its EventSource first (instances[0]) and the outer (chat) second (instances[1]).
    const plannerES = MockEventSource.instances[0]!;
    const chatES = MockEventSource.instances[1]!;

    const chatEvt: UIAppendEvent = {
      v: 1,
      id: "evt-c",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "ses_chat",
      op: "ui.append",
      node: { key: "c1", type: "test.node", props: {} },
    };
    const plannerEvt: UIAppendEvent = {
      v: 1,
      id: "evt-p1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "ses_planner",
      op: "ui.append",
      node: { key: "p1", type: "test.node", props: {} },
    };
    const plannerEvt2: UIAppendEvent = {
      v: 1,
      id: "evt-p2",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "ses_planner",
      op: "ui.append",
      node: { key: "p2", type: "test.node", props: {} },
    };

    act(() => {
      chatES.emit(chatEvt);
      plannerES.emit(plannerEvt);
      plannerES.emit(plannerEvt2);
    });

    expect(getByTestId("chat-count").textContent).toBe("1");
    expect(getByTestId("planner-count").textContent).toBe("2");
  });
});
