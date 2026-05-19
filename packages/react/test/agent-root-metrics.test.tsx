import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { AgentRoot } from "../src/agent-root.js";
import * as sseModule from "../src/sse-transport.js";

let connectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  connectSpy = vi.spyOn(sseModule, "connectSse").mockImplementation(async (opts) => {
    opts.onOpen();
    opts.onEvent(
      JSON.stringify({
        v: 1,
        id: "e1",
        ts: new Date().toISOString(),
        sessionId: "s",
        op: "ui.append",
        node: { key: "n1", type: "text-block", props: { text: "x" } },
      }),
      "e1",
    );
    await new Promise<void>((r) => opts.signal.addEventListener("abort", () => r()));
  });

  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sessionId: "real-uuid-abc" }), { status: 200 }),
  );
});

afterEach(() => {
  cleanup();
  connectSpy.mockRestore();
});

describe("AgentRoot — onMetric integration", () => {
  it("emits session.create_ms, stream.connect_ms, first_event_ms, parse_ms, dispatch_ms", async () => {
    const onMetric = vi.fn();
    render(
      <AgentRoot endpoint="http://x" onMetric={onMetric} tags={{ env: "test" }}>
        <div>child</div>
      </AgentRoot>,
    );

    await waitFor(() => {
      const names = onMetric.mock.calls.map((c) => c[0].name);
      expect(names).toContain("agentui.session.create_ms");
      expect(names).toContain("agentui.stream.connect_ms");
      expect(names).toContain("agentui.stream.first_event_ms");
      expect(names).toContain("agentui.event.parse_ms");
      expect(names).toContain("agentui.event.dispatch_ms");
    });
  });

  it("applies host tags to every metric", async () => {
    const onMetric = vi.fn();
    render(
      <AgentRoot endpoint="http://x" onMetric={onMetric} tags={{ env: "test" }}>
        <div>child</div>
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(onMetric.mock.calls.length).toBeGreaterThan(0);
    });

    for (const [m] of onMetric.mock.calls) {
      expect(m.tags.env).toBe("test");
    }
  });

  it("event metrics include eventOp; session metrics include hashed sessionId", async () => {
    const onMetric = vi.fn();
    render(
      <AgentRoot endpoint="http://x" onMetric={onMetric}>
        <div>child</div>
      </AgentRoot>,
    );

    await waitFor(() => {
      const eventMetrics = onMetric.mock.calls.filter((c) => c[0].name.startsWith("agentui.event."));
      expect(eventMetrics.length).toBeGreaterThan(0);
      for (const [m] of eventMetrics) {
        expect(m.tags.eventOp).toBeDefined();
      }
      const sessionMetrics = onMetric.mock.calls.filter((c) => c[0].name === "agentui.session.create_ms");
      expect(sessionMetrics.length).toBe(1);
      expect(sessionMetrics[0][0].tags.sessionId).toMatch(/^[0-9a-f]{8}$/);
    });
  });
});
