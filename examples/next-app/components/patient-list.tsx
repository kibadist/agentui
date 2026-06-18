"use client";

import { useAgentAction } from "@kibadist/agentui-react";
import type { ActionEvent } from "@kibadist/agentui-protocol";
import { StatusPill } from "./status-pill";

interface PatientRow {
  name: string;
  mrn: string;
  age: number;
  condition: string;
  status: string;
}

/** Clickable patient roster — a row click drills into that patient. */
export function PatientList({
  title,
  patients,
}: {
  title?: string;
  patients: PatientRow[];
}) {
  const sendAction = useAgentAction();

  const view = (mrn: string) => {
    const event: ActionEvent = {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId: "",
      kind: "action",
      type: "action.submit",
      name: "patient.view",
      payload: { mrn },
    };
    sendAction(event);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      {title && <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>}
      <div style={{ borderRadius: 8, border: "1px solid #222", overflow: "hidden" }}>
        {patients.map((p, i) => (
          <button
            key={p.mrn}
            onClick={() => view(p.mrn)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 14px",
              border: "none",
              borderTop: i === 0 ? "none" : "1px solid #1a1a1a",
              backgroundColor: "#111",
              color: "#ededed",
              cursor: "pointer",
              textAlign: "left",
              font: "inherit",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</span>
              <span style={{ fontSize: 12, color: "#888" }}>
                {p.mrn} · {p.age} · {p.condition}
              </span>
            </span>
            <StatusPill status={p.status} />
          </button>
        ))}
      </div>
    </div>
  );
}
