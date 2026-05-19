"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAgentDevToolsRecorder } from "./recorder.js";
import { Scrubber } from "./scrubber.js";

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
  width: 520,
  maxHeight: 480,
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
  maxHeight: 360,
  overflow: "hidden",
};

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

function AgentDevToolsImpl({ position = "br", maxEvents = 500 }: AgentDevToolsProps) {
  const { events } = useAgentDevToolsRecorder({ maxEvents });
  const [collapsed, setCollapsed] = useState(false);
  const [scrubPos, setScrubPos] = useState(0);
  const liveStickRef = useRef(true);

  // Keep scrubber stuck to "live" until the user grabs it.
  useEffect(() => {
    if (liveStickRef.current) setScrubPos(events.length);
  }, [events.length]);

  const onScrubChange = (next: number) => {
    liveStickRef.current = next >= events.length;
    setScrubPos(next);
  };

  return (
    <div style={{ ...panelStyle, ...corner(position) }}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600 }}>AgentDevTools</span>
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
            <div style={panelHalf} data-testid="event-log-panel">
              {/* Filled in Task 5 */}
              <div style={panelTitle}>Event Log ({events.length})</div>
            </div>
            <div style={panelHalf} data-testid="state-tree-panel">
              {/* Filled in Task 5 */}
              <div style={panelTitle}>State Tree</div>
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

const panelHalf: CSSProperties = {
  borderRight: "1px solid #2a2a30",
  overflow: "auto",
};

const panelTitle: CSSProperties = {
  padding: "6px 10px",
  fontSize: 11,
  color: "#a9a9b3",
  borderBottom: "1px solid #1a1a20",
};
