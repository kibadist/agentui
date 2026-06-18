import { describe, it, expect, vi } from "vitest";
import { RunRecorder, rollbackSummary } from "../src/agent/run-recorder.js";

/**
 * Model-independent proof that the instrumentation works: we drive a
 * `RunRecorder` directly (no LLM), simulating two real tool calls (start+end)
 * and a propose_rollback, then assert the captured emit() events reflect the
 * real tool order/status/durations and produce the right component shapes.
 */

interface Emitted {
  op: string;
  key?: string;
  replace?: boolean;
  node?: { key: string; type: string; props: Record<string, unknown> };
  props?: Record<string, unknown>;
}

function eventsFor(events: Emitted[], key: string): Emitted[] {
  return events.filter((e) => e.node?.key === key || e.key === key);
}

describe("RunRecorder instrumentation", () => {
  it("captures real tool order/status/durations and emits all live components", () => {
    const emit = vi.fn();
    const recorder = new RunRecorder(1, emit);
    const events = () => emit.mock.calls.map((c) => c[0] as Emitted);

    // Initial empty render (as the service does before the run).
    recorder.emitLive();

    // --- Tool call 1: list_services (success) ---
    const id1 = recorder.start("list_services", {});
    recorder.end(id1, { failed: false, result: [{ name: "checkout-service" }] });

    // --- Tool call 2: get_metrics (success) ---
    const id2 = recorder.start("get_metrics", { service: "checkout-service" });
    recorder.end(id2, {
      failed: false,
      result: [{ error_rate: 0.12, p99_ms: 1600, cpu: 0.74 }],
    });

    // --- propose_rollback -> checkpoint (start+end then checkpoint, as the
    // service's instrumented wrapper does) ---
    const id3 = recorder.start("propose_rollback", {
      service: "checkout-service",
      toVersion: "v2.4.0",
      reason: "v2.4.1 caused a 12% error-rate spike",
    });
    recorder.end(id3, { failed: false, result: "Rollback proposed for checkout-service to v2.4.0" });
    recorder.checkpoint(
      "checkout-service",
      "v2.4.0",
      "v2.4.1 caused a 12% error-rate spike",
      rollbackSummary(12, 1600, 211),
    );

    recorder.finish("Bad deploy checkout-service v2.4.1; roll back to v2.4.0.");

    const all = events();

    // tool-timeline: first ui.append then ui.replace, items reflect real calls.
    const tlEvents = eventsFor(all, "tl-1");
    expect(tlEvents[0]?.op).toBe("ui.append");
    expect(tlEvents.some((e) => e.op === "ui.replace" && e.replace === true)).toBe(true);

    const lastTl = tlEvents[tlEvents.length - 1];
    const items = (lastTl?.node?.props ?? lastTl?.props)?.items as Array<{
      id: string;
      label: string;
      status: string;
      durationMs?: number;
    }>;
    expect(items.map((i) => i.id)).toEqual([
      "list_services-1",
      "get_metrics-2",
      "propose_rollback-3",
    ]);
    expect(items[0].status).toBe("success");
    expect(items[1].status).toBe("success");
    expect(items.every((i) => typeof i.durationMs === "number")).toBe(true);

    // workflow-canvas: a node per step (+ plan/respond), edges sequential.
    const wfEvents = eventsFor(all, "wf-1");
    const lastWf = wfEvents[wfEvents.length - 1];
    const nodes = (lastWf?.node?.props ?? lastWf?.props)?.nodes as Array<{ id: string }>;
    expect(nodes.map((n) => n.id)).toEqual([
      "plan",
      "list_services-1",
      "get_metrics-2",
      "propose_rollback-3",
      "respond",
    ]);
    const edges = (lastWf?.node?.props ?? lastWf?.props)?.edges as Array<unknown>;
    expect(edges).toHaveLength(nodes.length - 1);

    // state-machine: present, ends awaiting (rollback proposed).
    const smEvents = eventsFor(all, "sm-1");
    const lastSm = smEvents[smEvents.length - 1];
    const smProps = lastSm?.node?.props ?? lastSm?.props;
    expect((smProps?.states as Array<unknown>).length).toBe(4);
    expect(smProps?.active).toBe("awaiting");

    // memory-map: one source per distinct tool + a Conclusion output node.
    const mmEvents = eventsFor(all, "mm-1");
    const lastMm = mmEvents[mmEvents.length - 1];
    const memNodes = (lastMm?.node?.props ?? lastMm?.props)?.nodes as Array<{
      id: string;
      type: string;
    }>;
    expect(memNodes.some((n) => n.id === "mem-output" && n.type === "output")).toBe(true);
    expect(memNodes.filter((n) => n.type !== "output").length).toBe(3);

    // review-checkpoint: a ui.append AFTER propose_rollback.
    const cpEvents = eventsFor(all, "cp-1");
    expect(cpEvents[0]?.op).toBe("ui.append");
    expect(cpEvents[0]?.node?.type).toBe("review-checkpoint");
    const cpProps = cpEvents[0]?.node?.props as Record<string, unknown>;
    expect(cpProps.title).toContain("checkout-service");
    expect(cpProps.level).toBe("high");
  });

  it("resolves inspect by step id to the recorded detail", () => {
    const recorder = new RunRecorder(2, vi.fn());
    const id = recorder.start("get_deploys", { service: "checkout-service" });
    recorder.end(id, { failed: false, result: [{ version: "v2.4.1" }] });
    expect(recorder.stepDetail("get_deploys-1")).toBeTruthy();
    expect(recorder.stepDetail("does-not-exist")).toBeNull();
  });
});
