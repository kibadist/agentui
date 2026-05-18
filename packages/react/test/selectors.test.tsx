import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { UIAppendEvent, UIRemoveEvent, UIReplaceEvent, UIToastEvent } from "@kibadist/agentui-protocol";
import {
  AgentStateProvider,
  createAgentStore,
  useAgentNodes,
  useAgentToasts,
  useAgentNavigate,
  useAgentSelector,
  type AgentState,
} from "../src/index.js";

// vitest is configured with `globals: false`, so RTL's auto-cleanup
// doesn't wire itself up automatically. Do it explicitly.
afterEach(cleanup);

function appendEvent(key: string): UIAppendEvent {
  return {
    v: 1,
    id: `evt-a-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.append",
    node: { key, type: "test.node", props: {} },
  };
}

function replaceEvent(key: string, props: Record<string, unknown>): UIReplaceEvent {
  return {
    v: 1,
    id: `evt-r-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.replace",
    key,
    props,
  };
}

function removeEvent(key: string): UIRemoveEvent {
  return {
    v: 1,
    id: `evt-x-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.remove",
    key,
  };
}

function toastEvent(message: string): UIToastEvent {
  return {
    v: 1,
    id: `evt-t-${message}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.toast",
    level: "info",
    message,
  };
}

// Render-counter probes. Each component increments its counter on every render
// and exposes the current value via a data attribute for inspection.
function makeProbe<T>(hook: () => T): {
  Probe: () => JSX.Element;
  renders: () => number;
  lastValue: () => T | undefined;
} {
  let count = 0;
  let last: T | undefined;
  const Probe = () => {
    count++;
    last = hook();
    return <span data-renders={count} />;
  };
  return { Probe, renders: () => count, lastValue: () => last };
}

describe("useAgentNodes / useAgentToasts — re-render boundary", () => {
  it("useAgentNodes does NOT re-render when only a toast arrives", () => {
    const store = createAgentStore();
    const nodes = makeProbe(useAgentNodes);
    const toasts = makeProbe(useAgentToasts);

    render(
      <AgentStateProvider store={store}>
        <nodes.Probe />
        <toasts.Probe />
      </AgentStateProvider>,
    );
    expect(nodes.renders()).toBe(1);
    expect(toasts.renders()).toBe(1);

    act(() => {
      store.send(toastEvent("hello"));
    });

    expect(nodes.renders()).toBe(1);   // unchanged
    expect(toasts.renders()).toBe(2);  // updated
  });
});

describe("useAgentSelector — change detection", () => {
  it("returns a stable value across ui.replace (nodes.length unchanged)", () => {
    const store = createAgentStore();
    const probe = makeProbe(() => useAgentSelector((s: AgentState) => s.nodes.length));

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.renders()).toBe(1);
    expect(probe.lastValue()).toBe(0);

    act(() => {
      store.send(appendEvent("a"));
    });
    expect(probe.renders()).toBe(2);
    expect(probe.lastValue()).toBe(1);

    act(() => {
      store.send(replaceEvent("a", { x: 1 }));
    });
    // length is still 1; probe must not re-render.
    expect(probe.renders()).toBe(2);
    expect(probe.lastValue()).toBe(1);
  });

  it("updates only when the selected key's index changes", () => {
    const store = createAgentStore();
    const probe = makeProbe(() => useAgentSelector((s: AgentState) => s.byKey.get("foo")));

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.renders()).toBe(1);
    expect(probe.lastValue()).toBeUndefined();

    act(() => {
      store.send(appendEvent("a"));   // foo doesn't exist; selector returns undefined → no change
    });
    expect(probe.renders()).toBe(1);

    act(() => {
      store.send(appendEvent("b"));
      store.send(appendEvent("foo"));
    });
    // After two sends foo exists at index 2; probe re-renders once per send.
    // We sent twice so two re-renders are possible — but only the second one
    // changed the selector value. Allow either 2 or 3 renders here.
    const rendersAfterAppends = probe.renders();
    expect(rendersAfterAppends).toBeGreaterThanOrEqual(2);
    expect(probe.lastValue()).toBe(2);

    act(() => {
      store.send(removeEvent("a"));   // shifts foo from 2 → 1
    });
    expect(probe.lastValue()).toBe(1);
    const rendersAfterShift = probe.renders();
    expect(rendersAfterShift).toBe(rendersAfterAppends + 1);

    // Sharpest boundary: append + remove of an UNRELATED key.
    // foo's index stays 1 throughout, so the cached selector value matches
    // and the consumer does not re-render even though the store notifies twice.
    act(() => {
      store.send(appendEvent("zzz"));
      store.send(removeEvent("zzz"));
    });
    expect(probe.lastValue()).toBe(1);
    expect(probe.renders()).toBe(rendersAfterShift);
  });

  it("custom eq is honored (fresh object literal stays stable)", () => {
    const store = createAgentStore();
    const probe = makeProbe(() =>
      useAgentSelector(
        (s: AgentState) => ({ id: s.nodes[0]?.key ?? null }),
        (a, b) => a.id === b.id,
      ),
    );

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.renders()).toBe(1);

    // A toast event does not change s.nodes[0]?.key → custom eq says equal → no re-render.
    act(() => {
      store.send(toastEvent("hi"));
    });
    expect(probe.renders()).toBe(1);

    // An append changes nodes[0].key from null → "a" → eq says not equal → re-render.
    act(() => {
      store.send(appendEvent("a"));
    });
    expect(probe.renders()).toBe(2);
    expect(probe.lastValue()).toEqual({ id: "a" });
  });
});

describe("AgentStateProvider — guardrails", () => {
  it("throws a clear error when a selector hook is used outside the provider", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const probe = makeProbe(useAgentNodes);

    expect(() => render(<probe.Probe />)).toThrow(/AgentStateProvider/);

    errSpy.mockRestore();
  });
});

// Touch-test: useAgentNavigate exists, returns null initially, updates on ui.navigate.
describe("useAgentNavigate — smoke", () => {
  it("returns the latest navigate intent (or null)", () => {
    const store = createAgentStore();
    const probe = makeProbe(useAgentNavigate);

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.lastValue()).toBeNull();

    act(() => {
      store.send({
        v: 1,
        id: "n",
        ts: "2026-01-01T00:00:00Z",
        sessionId: "s1",
        op: "ui.navigate",
        href: "/somewhere",
      });
    });
    expect(probe.lastValue()).toEqual({ href: "/somewhere", replace: undefined });
  });
});
