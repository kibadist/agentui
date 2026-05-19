"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAgentDevToolsRecorder } from "./recorder.js";
import { Scrubber } from "./scrubber.js";
import { EventLog, type EventLogFilters } from "./event-log.js";
import { StateTree } from "./state-tree.js";
import { createInitialAgentState } from "../reducer.js";

/** Props for `<AgentDevTools />`. */
export interface AgentDevToolsProps {
  /**
   * Force the panel on or off. Default: enabled when
   * `process.env.NODE_ENV !== "production"` OR
   * `process.env.NEXT_PUBLIC_AGENTUI_DEVTOOLS === "1"`.
   */
  enabled?: boolean;
  /** Corner anchor. Default: "br". */
  position?: "br" | "bl" | "tr" | "tl";
  /** Ring buffer cap. Default 500. */
  maxEvents?: number;
  /** Scope to a specific `<AgentRoot id="…">`. Omit to use the nearest. */
  id?: string;
}

function resolveEnabled(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  const env = proc?.env ?? {};
  if (env.NODE_ENV !== "production") return true;
  return env.NEXT_PUBLIC_AGENTUI_DEVTOOLS === "1";
}

function corner(position: AgentDevToolsProps["position"]): CSSProperties {
  switch (position) {
    case "bl":
      return { left: 12, bottom: 12 };
    case "tr":
      return { right: 12, top: 12 };
    case "tl":
      return { left: 12, top: 12 };
    case "br":
    default:
      return { right: 12, bottom: 12 };
  }
}

const panelStyle: CSSProperties = {
  position: "fixed",
  zIndex: 2147483000,
  background: "#0e0e12",
  color: "#e6e6ea",
  border: "1px solid #2a2a30",
  borderRadius: 8,
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  width: 640,
  maxHeight: 520,
  display: "flex",
  flexDirection: "column",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 10px",
  borderBottom: "1px solid #2a2a30",
  fontSize: 12,
  userSelect: "none",
  cursor: "move",
};

const bodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 0,
  minHeight: 200,
  maxHeight: 380,
  overflow: "hidden",
};

const halfStyle: CSSProperties = { borderRight: "1px solid #2a2a30", overflow: "auto" };

/**
 * Floating debug panel. Opt-in: defaults to enabled in non-production and
 * when `NEXT_PUBLIC_AGENTUI_DEVTOOLS=1`, otherwise renders null.
 *
 * Must be mounted inside `<AgentRoot>`. Shows the live wire-event log, the
 * current `AgentState` (or a past snapshot via the scrubber), and dispatch
 * latency. Time-travel only changes what the panel renders; the host app
 * continues to render live state.
 */
export function AgentDevTools(props: AgentDevToolsProps) {
  const enabled = resolveEnabled(props.enabled);
  if (!enabled) return null;
  return <AgentDevToolsImpl {...props} />;
}

function computeLatencyStats(events: ReturnType<typeof useAgentDevToolsRecorder>["events"]) {
  if (events.length === 0) return { mean: 0, p99: 0 };
  const recent = events.slice(-100).map((e) => e.dispatchMs).sort((a, b) => a - b);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const p99 = recent[Math.min(recent.length - 1, Math.floor(recent.length * 0.99))];
  return { mean, p99 };
}

function AgentDevToolsImpl({ position = "br", maxEvents = 500 }: AgentDevToolsProps) {
  const { events } = useAgentDevToolsRecorder({ maxEvents });
  const [collapsed, setCollapsed] = useState(false);
  const [scrubPos, setScrubPos] = useState(0);
  const liveStickRef = useRef(true);
  const [filters, setFilters] = useState<EventLogFilters>({
    ui: true,
    tool: true,
    reasoning: true,
    optimistic: true,
    session: true,
  });
  const [search, setSearch] = useState("");

  // Keep scrubber stuck to "live" until the user grabs it.
  useEffect(() => {
    if (liveStickRef.current) setScrubPos(events.length);
  }, [events.length]);

  const onScrubChange = (next: number) => {
    liveStickRef.current = next >= events.length;
    setScrubPos(next);
  };

  // View state = the cached snapshot at events[scrubPos-1], or initial when scrubPos=0.
  const viewState = useMemo(() => {
    if (scrubPos >= events.length) {
      return events.length > 0 ? events[events.length - 1].state : createInitialAgentState();
    }
    if (scrubPos === 0) return createInitialAgentState();
    return events[scrubPos - 1].state;
  }, [events, scrubPos]);

  const { mean, p99 } = computeLatencyStats(events);

  return (
    <div style={{ ...panelStyle, ...corner(position) }}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600 }}>AgentDevTools</span>
        <span style={{ color: "#a9a9b3", fontSize: 11 }}>
          mean {mean.toFixed(2)}ms · p99 {p99.toFixed(2)}ms
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand" : "Collapse"}
            style={chromeButton}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div style={bodyStyle}>
            <div style={halfStyle} data-testid="event-log-panel">
              <EventLog
                events={events}
                scrubPos={scrubPos}
                onScrub={onScrubChange}
                filters={filters}
                onFiltersChange={setFilters}
                search={search}
                onSearchChange={setSearch}
              />
            </div>
            <div style={halfStyle} data-testid="state-tree-panel">
              <StateTree state={viewState} />
            </div>
          </div>
          <Scrubber total={events.length} value={scrubPos} onChange={onScrubChange} />
        </>
      )}
    </div>
  );
}

const chromeButton: CSSProperties = {
  background: "transparent",
  color: "#a9a9b3",
  border: "1px solid #2a2a30",
  borderRadius: 4,
  padding: "0 6px",
  fontSize: 11,
  cursor: "pointer",
};
