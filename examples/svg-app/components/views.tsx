"use client";

import { useCallback } from "react";
import { useAgentAction } from "@kibadist/agentui-react";
import type { ActionEvent } from "@kibadist/agentui-protocol";
import { SvgElement } from "./svg-element";

/**
 * Thin React "view" components for the agent-observability registry. Each SVG
 * view renders an optional card title plus a sized host box that the SVG Web
 * Component fills, and wires its custom events back to the agent as
 * ActionEvents via `useAgentAction()` (these views are rendered inside
 * `AgentActionProvider`, so the hook resolves).
 */

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 12,
  marginBottom: 16,
};

const titleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 16,
  color: "#0a0a0a",
};

interface SelectDetail {
  id?: string;
}

interface DecisionDetail {
  action?: string;
  note?: string;
}

/** Build the ActionEvent that an `inspect` produces. */
function inspectEvent(kind: string, detail: unknown): ActionEvent {
  const id = (detail as SelectDetail)?.id ?? "";
  return {
    v: 1,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    sessionId: "",
    kind: "action",
    type: "action.submit",
    name: "agent.inspect",
    payload: { kind, id },
  };
}

// ─── workflow-canvas ─────────────────────────────────────────────────────────

interface WorkflowNode {
  id: string;
  label: string;
  sublabel?: string;
  status?: string;
}
interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  status?: string;
}

export function WorkflowCanvasView({
  title,
  nodes,
  edges,
}: {
  title?: string;
  nodes: WorkflowNode[];
  edges?: WorkflowEdge[];
}) {
  const sendAction = useAgentAction();
  const inspect = useCallback(
    (kind: string, detail: unknown) => sendAction(inspectEvent(kind, detail)),
    [sendAction],
  );

  return (
    <div style={cardStyle}>
      {title && <h3 style={titleStyle}>{title}</h3>}
      <SvgElement
        tag="agentui-workflow-canvas"
        data={{ nodes, edges }}
        on={{ "agentui:select": (d) => inspect("node", d) }}
        style={{ height: 340 }}
      />
    </div>
  );
}

// ─── tool-timeline ───────────────────────────────────────────────────────────

interface TimelineItem {
  id: string;
  label: string;
  status?: string;
  durationMs?: number;
  detail?: string;
}

export function ToolTimelineView({
  title,
  items,
}: {
  title?: string;
  items: TimelineItem[];
}) {
  const sendAction = useAgentAction();
  const inspect = useCallback(
    (kind: string, detail: unknown) => sendAction(inspectEvent(kind, detail)),
    [sendAction],
  );

  return (
    <div style={cardStyle}>
      {title && <h3 style={titleStyle}>{title}</h3>}
      <SvgElement
        tag="agentui-tool-timeline"
        data={{ items }}
        attrs={{ density: "expanded" }}
        on={{ "agentui:select": (d) => inspect("item", d) }}
        style={{ height: 280 }}
      />
    </div>
  );
}

// ─── state-machine ───────────────────────────────────────────────────────────

interface StateNode {
  id: string;
  label?: string;
  status?: string;
}
interface Transition {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export function StateMachineView({
  title,
  states,
  transitions,
  active,
}: {
  title?: string;
  states: StateNode[];
  transitions?: Transition[];
  active?: string;
}) {
  const sendAction = useAgentAction();
  const inspect = useCallback(
    (kind: string, detail: unknown) => sendAction(inspectEvent(kind, detail)),
    [sendAction],
  );

  return (
    <div style={cardStyle}>
      {title && <h3 style={titleStyle}>{title}</h3>}
      <SvgElement
        tag="agentui-state-machine"
        data={{ states, transitions, active }}
        attrs={{ layout: "horizontal" }}
        on={{ "agentui:select": (d) => inspect("state", d) }}
        style={{ height: 240 }}
      />
    </div>
  );
}

// ─── memory-map ──────────────────────────────────────────────────────────────

interface MemoryNode {
  id: string;
  label: string;
  type?: string;
  group?: string;
}
interface MemoryLink {
  id: string;
  from: string;
  to: string;
  strength?: number;
}

export function MemoryMapView({
  title,
  nodes,
  links,
}: {
  title?: string;
  nodes: MemoryNode[];
  links?: MemoryLink[];
}) {
  const sendAction = useAgentAction();
  const inspect = useCallback(
    (kind: string, detail: unknown) => sendAction(inspectEvent(kind, detail)),
    [sendAction],
  );

  return (
    <div style={cardStyle}>
      {title && <h3 style={titleStyle}>{title}</h3>}
      <SvgElement
        tag="agentui-memory-map"
        data={{ nodes, links }}
        on={{
          "agentui:select": (d) => inspect("memory", d),
          "agentui:remove": (d) => console.log("memory remove", d),
          "agentui:edit": (d) => console.log("memory edit", d),
        }}
        style={{ height: 340 }}
      />
    </div>
  );
}

// ─── review-checkpoint ───────────────────────────────────────────────────────

export function ReviewCheckpointView(props: {
  title: string;
  description?: string;
  level?: string;
  summary?: string;
}) {
  const sendAction = useAgentAction();
  const decide = useCallback(
    (detail: unknown) => {
      const d = detail as DecisionDetail;
      const event: ActionEvent = {
        v: 1,
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        sessionId: "",
        kind: "action",
        type: "action.submit",
        name: "agent.decision",
        payload: { action: d?.action ?? "", note: d?.note ?? "" },
      };
      sendAction(event);
    },
    [sendAction],
  );

  return (
    <div style={cardStyle}>
      <SvgElement
        tag="agentui-review-checkpoint"
        data={props}
        on={{ "agentui:decision": (d) => decide(d) }}
        style={{ height: 220 }}
      />
    </div>
  );
}

// ─── text-block (plain React, NOT a web component) ───────────────────────────

/** Render the inline markdown the agent commonly emits: **bold** and *italic*. */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<strong key={i++}>{m[1]}</strong>);
    else parts.push(<em key={i++}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function TextBlock({ title, body }: { title?: string; body: string }) {
  return (
    <div style={cardStyle}>
      {title && <h3 style={titleStyle}>{title}</h3>}
      <p
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.6,
          color: "#1f2937",
          whiteSpace: "pre-wrap",
        }}
      >
        {renderInlineMarkdown(body)}
      </p>
    </div>
  );
}
