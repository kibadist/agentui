import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  AgentRoot,
  useAgentHistory,
} from "../src/index.js";
import type { SessionStorageAdapter } from "../src/index.js";

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

function wrapInRoot(
  children: ReactNode,
  fetchMock: ReturnType<typeof vi.fn>,
): JSX.Element {
  return (
    <AgentRoot endpoint="/api/agent" storage={makeStorage()} fetch={fetchMock}>
      {children}
    </AgentRoot>
  );
}

describe("useAgentHistory", () => {
  it("fetches history on session start and exposes messages", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/session")) {
        return new Response(JSON.stringify({ sessionId: "s1" }), { status: 200 });
      }
      if (url.includes("/history")) {
        return new Response(
          JSON.stringify({
            messages: [
              { role: "user", text: "hello", ts: "2026-01-01T00:00:00Z" },
              { role: "assistant", text: "hi there", ts: "2026-01-01T00:00:01Z" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    function Probe() {
      const h = useAgentHistory();
      return (
        <>
          <span data-testid="loading">{h.loading ? "yes" : "no"}</span>
          <span data-testid="count">{h.messages.length}</span>
        </>
      );
    }

    const { getByTestId } = render(wrapInRoot(<Probe />, fetchMock));

    await waitFor(() => {
      expect(getByTestId("count").textContent).toBe("2");
    });
    expect(getByTestId("loading").textContent).toBe("no");
  });

  it("404 history → messages: [], no error fired", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/session")) {
        return new Response(JSON.stringify({ sessionId: "s2" }), { status: 200 });
      }
      if (url.includes("/history")) {
        return new Response("no history", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    });

    function Probe() {
      const h = useAgentHistory();
      return (
        <>
          <span data-testid="count">{h.messages.length}</span>
          <span data-testid="error">{h.error?.kind ?? "none"}</span>
        </>
      );
    }

    const { getByTestId } = render(wrapInRoot(<Probe />, fetchMock));

    await waitFor(() => {
      expect(getByTestId("count").textContent).toBe("0");
    });
    expect(getByTestId("error").textContent).toBe("none");
  });

  it("reload() re-fires the GET and replaces messages", async () => {
    let historyCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/session")) {
        return new Response(JSON.stringify({ sessionId: "s3" }), { status: 200 });
      }
      if (url.includes("/history")) {
        historyCallCount++;
        if (historyCallCount === 1) {
          return new Response(
            JSON.stringify({ messages: [{ role: "user", text: "one", ts: "t" }] }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            messages: [
              { role: "user", text: "one", ts: "t" },
              { role: "assistant", text: "two", ts: "t" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    function Probe() {
      const h = useAgentHistory();
      return (
        <>
          <span data-testid="count">{h.messages.length}</span>
          <button data-testid="reload-btn" onClick={() => h.reload()}>
            reload
          </button>
        </>
      );
    }

    const { getByTestId } = render(wrapInRoot(<Probe />, fetchMock));

    await waitFor(() => {
      expect(getByTestId("count").textContent).toBe("1");
    });

    await act(async () => {
      getByTestId("reload-btn").click();
    });

    await waitFor(() => {
      expect(getByTestId("count").textContent).toBe("2");
    });
  });
});
