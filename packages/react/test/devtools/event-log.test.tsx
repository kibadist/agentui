import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EventLog } from "../../src/devtools/event-log.js";
import type { RecordedEvent } from "../../src/devtools/recorder.js";
import { createInitialAgentState } from "../../src/reducer.js";

function mk(seq: number, op: string, extra: Record<string, unknown> = {}): RecordedEvent {
  return {
    seq,
    action: { op, id: `e-${seq}`, ts: "2026-05-19T00:00:00Z", sessionId: "s", ...extra } as never,
    capturedAt: 0,
    state: createInitialAgentState(),
    dispatchMs: 0.5,
  };
}

describe("<EventLog />", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one row per event with op and seq", () => {
    const events = [
      mk(0, "ui.append", { node: { key: "k1", type: "text-block", props: { text: "a" } } }),
      mk(1, "tool.start", { name: "search" }),
    ];
    render(
      <EventLog
        events={events}
        scrubPos={2}
        onScrub={() => {}}
        filters={{ ui: true, tool: true, reasoning: true, optimistic: true, session: true }}
        onFiltersChange={() => {}}
        search=""
        onSearchChange={() => {}}
      />,
    );
    expect(screen.getByText(/#0/)).toBeTruthy();
    expect(screen.getByText(/ui\.append/)).toBeTruthy();
    expect(screen.getByText(/#1/)).toBeTruthy();
    expect(screen.getByText(/tool\.start/)).toBeTruthy();
  });

  it("filters hide rows of unchecked categories", () => {
    const events = [
      mk(0, "ui.append", { node: { key: "k1", type: "text-block", props: { text: "a" } } }),
      mk(1, "tool.start", { name: "search" }),
    ];
    render(
      <EventLog
        events={events}
        scrubPos={2}
        onScrub={() => {}}
        filters={{ ui: true, tool: false, reasoning: true, optimistic: true, session: true }}
        onFiltersChange={() => {}}
        search=""
        onSearchChange={() => {}}
      />,
    );
    expect(screen.queryByText(/tool\.start/)).toBeNull();
    expect(screen.getByText(/ui\.append/)).toBeTruthy();
  });

  it("search filters by op name", () => {
    const events = [
      mk(0, "ui.append", { node: { key: "k1", type: "text-block", props: { text: "a" } } }),
      mk(1, "tool.start", { name: "search" }),
    ];
    render(
      <EventLog
        events={events}
        scrubPos={2}
        onScrub={() => {}}
        filters={{ ui: true, tool: true, reasoning: true, optimistic: true, session: true }}
        onFiltersChange={() => {}}
        search="tool"
        onSearchChange={() => {}}
      />,
    );
    expect(screen.queryByText(/ui\.append/)).toBeNull();
    expect(screen.getByText(/tool\.start/)).toBeTruthy();
  });

  it("clicking a row calls onScrub with seq+1", () => {
    let scrubbed = -1;
    const events = [
      mk(0, "ui.append", { node: { key: "k1", type: "text-block", props: { text: "a" } } }),
    ];
    render(
      <EventLog
        events={events}
        scrubPos={1}
        onScrub={(n) => {
          scrubbed = n;
        }}
        filters={{ ui: true, tool: true, reasoning: true, optimistic: true, session: true }}
        onFiltersChange={() => {}}
        search=""
        onSearchChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/#0/));
    expect(scrubbed).toBe(1); // seq 0 → scrubPos 1 (state AFTER event 0)
  });
});
