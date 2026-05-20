"use client";

import { useToolCalls } from "@kibadist/agentui-react";

export function ToolCallsList() {
  const calls = useToolCalls();
  if (calls.length === 0) return null;
  return (
    <div style={{ margin: "12px 0" }}>
      {calls.map((c) => (
        <div
          key={c.id}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 9999,
            fontSize: 12,
            marginRight: 8,
            color: "#cbd5e1",
          }}
        >
          <span style={{
            width: 6,
            height: 6,
            borderRadius: 9999,
            background: c.status === "pending" ? "#fbbf24" : c.status === "ok" ? "#4ade80" : "#f87171",
          }} />
          {c.name}
        </div>
      ))}
    </div>
  );
}
