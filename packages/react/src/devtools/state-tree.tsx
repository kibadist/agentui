"use client";

import { type CSSProperties } from "react";
import type { AgentState } from "../reducer.js";

interface StateTreeProps {
  state: AgentState;
}

const wrap: CSSProperties = { fontSize: 11, padding: "6px 10px", overflowY: "auto", height: "100%" };
const section: CSSProperties = { marginBottom: 6 };
const summary: CSSProperties = { cursor: "pointer", color: "#e6e6ea", fontWeight: 600 };
const entry: CSSProperties = {
  marginLeft: 14,
  color: "#a9a9b3",
  fontVariantNumeric: "tabular-nums",
};

export function StateTree({ state }: StateTreeProps) {
  return (
    <div style={wrap}>
      <details open style={section}>
        <summary style={summary}>nodes ({state.nodes.length})</summary>
        {state.nodes.map((n, i) => (
          <div key={n.key} style={entry}>
            [{i}] {n.type} <span style={{ color: "#7dd3fc" }}>{n.key}</span>
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>toolCalls ({state.toolCalls.size})</summary>
        {Array.from(state.toolCalls.values()).map((t) => (
          <div key={t.id} style={entry}>
            {t.id} {t.name} <span style={{ color: opColorFor(t.status) }}>{t.status}</span>
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>reasoning ({state.reasoning.size})</summary>
        {Array.from(state.reasoning.values()).map((r) => (
          <div key={r.id} style={entry}>
            {r.id} <span style={{ color: r.status === "done" ? "#86efac" : "#fbbf77" }}>{r.status}</span>{" "}
            {r.text.length}c
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>optimistic ({state.optimistic.size})</summary>
        {Array.from(state.optimistic.values()).map((o) => (
          <div key={o.originId} style={entry}>
            {o.entityKey} origin={o.originId}
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>toasts ({state.toasts.length})</summary>
        {state.toasts.map((t) => (
          <div key={t.id} style={entry}>
            {t.level}: {t.message}
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>navigate</summary>
        <div style={entry}>{state.navigate ? state.navigate.href : "—"}</div>
      </details>
      <details style={section}>
        <summary style={summary}>byKey ({state.byKey.size})</summary>
        {Array.from(state.byKey.entries()).map(([k, i]) => (
          <div key={k} style={entry}>
            {k} → [{i}]
          </div>
        ))}
      </details>
    </div>
  );
}

function opColorFor(status: string): string {
  switch (status) {
    case "ok":
      return "#86efac";
    case "error":
      return "#fda4af";
    case "cancelled":
      return "#a9a9b3";
    default:
      return "#fbbf77";
  }
}
