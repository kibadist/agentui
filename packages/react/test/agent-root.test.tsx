import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";
import {
  AgentRoot,
  useAgentNodes,
  useAgentSession,
} from "../src/index.js";
import type {
  AgentError,
  SessionStorageAdapter,
  UIAppendEvent,
} from "../src/index.js";
import * as sseModule from "../src/sse-transport.js";

type ConnectOpts = Parameters<typeof sseModule.connectSse>[0];

function makeStorage(initial: Record<string, string> = {}): SessionStorageAdapter & {
  _store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));
  return {
    _store: store,
    get(key) {
      return store.get(key) ?? null;
    },
    set(key, value) {
      store.set(key, value);
    },
    remove(key) {
      store.delete(key);
    },
  };
}

function makeFetchMock(handlers: Record<string, (url: string, init?: RequestInit) => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) return handler(url, init);
    }
    return new Response("not found", { status: 404 });
  });
}

// Per-test SSE connection opts, populated by the spy.
let connectOptsList: ConnectOpts[] = [];
let connectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  connectOptsList = [];
  connectSpy = vi.spyOn(sseModule, "connectSse").mockImplementation(async (opts) => {
    connectOptsList.push(opts);
    opts.onOpen();
    // Stay open until the signal is aborted.
    return new Promise<void>((resolve) => {
      opts.signal.addEventListener("abort", () => resolve());
    });
  });
});

afterEach(() => {
  cleanup();
  connectSpy.mockRestore();
});

/** Push a raw JSON event through the most-recently established SSE connection. */
function emitToLatest(data: unknown) {
  const opts = connectOptsList[connectOptsList.length - 1];
  opts?.onEvent(JSON.stringify(data), undefined);
}

function StatusProbe() {
  const s = useAgentSession();
  return (
    <>
      <span data-testid="status">{s.status}</span>
      <span data-testid="session-id">{s.sessionId ?? ""}</span>
      <span data-testid="conversation-id">{s.conversationId ?? ""}</span>
    </>
  );
}

describe("AgentRoot", () => {
  it("fresh session: mount → POST /session → SSE opens → status connected", async () => {
    const storage = makeStorage();
    const fetchMock = makeFetchMock({
      "/session": () =>
        new Response(JSON.stringify({ sessionId: "ses_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const { getByTestId } = render(
      <AgentRoot endpoint="/api/agent" storage={storage} fetch={fetchMock}>
        <StatusProbe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });
    expect(getByTestId("session-id").textContent).toBe("ses_1");

    const sessionCalls = fetchMock.mock.calls.filter(([url]) =>
      (typeof url === "string" ? url : url.toString()).includes("/session"),
    );
    expect(sessionCalls.length).toBeGreaterThanOrEqual(1);
    const firstUrl = sessionCalls[0][0] as string;
    expect(firstUrl).toContain("/session");
    expect(firstUrl).not.toContain("conversationId=");
  });

  it("resume: mount with persisted conversationId → POST includes conversationId", async () => {
    const storage = makeStorage({
      "agentui:default:conversationId": "conv_persisted",
    });
    const fetchMock = makeFetchMock({
      "/session": () =>
        new Response(JSON.stringify({ sessionId: "ses_resumed" }), { status: 200 }),
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    });

    const { getByTestId } = render(
      <AgentRoot endpoint="/api/agent" storage={storage} fetch={fetchMock}>
        <StatusProbe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });

    const sessionCall = fetchMock.mock.calls.find(([url]) =>
      (typeof url === "string" ? url : url.toString()).includes("/session"),
    );
    const url = sessionCall![0] as string;
    expect(url).toContain("conversationId=conv_persisted");
  });

  it("resume 404 → falls back to fresh session and clears storage", async () => {
    const storage = makeStorage({
      "agentui:default:conversationId": "conv_dead",
    });
    let callCount = 0;
    const fetchMock = makeFetchMock({
      "/session": (url) => {
        callCount++;
        if (url.includes("conversationId=") && callCount === 1) {
          return new Response("conversation not found", { status: 404 });
        }
        return new Response(JSON.stringify({ sessionId: "ses_fresh" }), { status: 200 });
      },
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    });
    const errors: AgentError[] = [];

    const { getByTestId } = render(
      <AgentRoot
        endpoint="/api/agent"
        storage={storage}
        fetch={fetchMock}
        onError={(err) => errors.push(err)}
      >
        <StatusProbe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });

    expect(getByTestId("session-id").textContent).toBe("ses_fresh");
    expect(storage._store.has("agentui:default:conversationId")).toBe(false);
    expect(errors.some((e) => e.kind === "session-resume")).toBe(true);
  });

  it("reset(): clears storage, dispatches __reset__, creates a new session", async () => {
    const storage = makeStorage({
      "agentui:default:conversationId": "conv_old",
    });
    const fetchMock = makeFetchMock({
      "/session": () =>
        new Response(JSON.stringify({ sessionId: "ses_1" }), { status: 200 }),
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    });

    function NodesProbe() {
      const nodes = useAgentNodes();
      return <span data-testid="nodes-count">{nodes.length}</span>;
    }

    function ResetButton() {
      const s = useAgentSession();
      return (
        <button data-testid="reset-btn" onClick={() => s.reset()}>
          reset
        </button>
      );
    }

    const { getByTestId } = render(
      <AgentRoot endpoint="/api/agent" storage={storage} fetch={fetchMock}>
        <StatusProbe />
        <NodesProbe />
        <ResetButton />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });

    const appendEvt: UIAppendEvent = {
      v: 1,
      id: "evt-append",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "ses_1",
      op: "ui.append",
      node: { key: "a", type: "test.node", props: {} },
    };
    act(() => {
      emitToLatest(appendEvt);
    });
    expect(getByTestId("nodes-count").textContent).toBe("1");

    const resetCallCountBefore = fetchMock.mock.calls.filter(([u]) =>
      (typeof u === "string" ? u : u.toString()).includes("/session"),
    ).length;

    await act(async () => {
      getByTestId("reset-btn").click();
    });

    await waitFor(() => {
      expect(storage._store.has("agentui:default:conversationId")).toBe(false);
      expect(getByTestId("nodes-count").textContent).toBe("0");
    });
    const resetCallCountAfter = fetchMock.mock.calls.filter(([u]) =>
      (typeof u === "string" ? u : u.toString()).includes("/session"),
    ).length;
    expect(resetCallCountAfter).toBeGreaterThan(resetCallCountBefore);
  });

  it("session.meta event → storage receives conversationId; useAgentSession reflects it", async () => {
    const storage = makeStorage();
    const fetchMock = makeFetchMock({
      "/session": () =>
        new Response(JSON.stringify({ sessionId: "ses_meta" }), { status: 200 }),
      "/history": () =>
        new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    });

    const { getByTestId } = render(
      <AgentRoot endpoint="/api/agent" storage={storage} fetch={fetchMock}>
        <StatusProbe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("connected");
    });

    act(() => {
      emitToLatest({
        v: 1,
        id: "evt-meta",
        ts: "2026-01-01T00:00:01Z",
        sessionId: "ses_meta",
        op: "session.meta",
        conversationId: "conv_new",
      });
    });

    await waitFor(() => {
      expect(getByTestId("conversation-id").textContent).toBe("conv_new");
    });
    expect(storage._store.get("agentui:default:conversationId")).toBe("conv_new");
  });

  it("SSE connect receives the same fetch wrapper as session/action calls", async () => {
    // Regression for github.com/kibadist/agentui#1: SSE transport must use
    // the host-supplied fetch override, not bare global fetch.
    const storage = makeStorage();
    const fetchMock = makeFetchMock({
      "/session": () =>
        new Response(JSON.stringify({ sessionId: "ses_1" }), { status: 200 }),
    });

    render(
      <AgentRoot endpoint="/api/agent" storage={storage} fetch={fetchMock}>
        <StatusProbe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(connectOptsList.length).toBe(1);
    });
    expect(connectOptsList[0].fetch).toBe(fetchMock);
  });

  it("transport prop: drives session create + action dispatch through the supplied Transport (no httpTransport involvement)", async () => {
    const storage = makeStorage();
    const createSession = vi
      .fn()
      .mockResolvedValue({ sessionId: "ses_custom" });
    const openStream = vi.fn(async (opts: ConnectOpts & { onOpen: () => void }) => {
      opts.onOpen();
      await new Promise<void>((resolve) => {
        opts.signal.addEventListener("abort", () => resolve());
      });
    });
    const dispatchAction = vi.fn().mockResolvedValue(undefined);
    const getHistory = vi.fn().mockResolvedValue({ messages: [] });

    const customTransport = {
      createSession,
      openStream,
      dispatchAction,
      getHistory,
    };

    function Probe() {
      const s = useAgentSession();
      return <span data-testid="sid">{s.sessionId ?? ""}</span>;
    }

    const { getByTestId } = render(
      <AgentRoot transport={customTransport} storage={storage}>
        <Probe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("sid").textContent).toBe("ses_custom");
    });

    expect(createSession).toHaveBeenCalledOnce();
    expect(openStream).toHaveBeenCalledOnce();
    // The connectSse spy must NOT have fired — proving httpTransport was bypassed.
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("transport prop: a custom transport's SessionNotFoundError on resume falls back to fresh session", async () => {
    const storage = makeStorage({
      "agentui:default:conversationId": "conv_gone",
    });
    let createCalls = 0;
    const customTransport = {
      createSession: vi.fn(async (opts: { conversationId?: string }) => {
        createCalls++;
        if (opts.conversationId === "conv_gone") {
          // Mirrors what httpTransport throws on 404 resume.
          const { SessionNotFoundError } = await import(
            "@kibadist/agentui-protocol"
          );
          throw new SessionNotFoundError(opts.conversationId);
        }
        return { sessionId: "ses_fresh" };
      }),
      openStream: vi.fn(async (opts: ConnectOpts & { onOpen: () => void }) => {
        opts.onOpen();
        await new Promise<void>((resolve) => {
          opts.signal.addEventListener("abort", () => resolve());
        });
      }),
      dispatchAction: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockResolvedValue({ messages: [] }),
    };

    function Probe() {
      const s = useAgentSession();
      return <span data-testid="sid">{s.sessionId ?? ""}</span>;
    }

    const { getByTestId } = render(
      <AgentRoot transport={customTransport} storage={storage}>
        <Probe />
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(getByTestId("sid").textContent).toBe("ses_fresh");
    });
    expect(createCalls).toBe(2);
    expect(storage._store.has("agentui:default:conversationId")).toBe(false);
  });
});
