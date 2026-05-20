"use client";

import { useReasoning } from "@kibadist/agentui-react";

export function ReasoningPanel() {
  const reasoning = useReasoning();
  if (reasoning.length === 0) return null;
  return (
    <details style={{ background: "#171717", border: "1px solid #262626", borderRadius: 8, padding: "8px 12px", margin: "12px 0", fontSize: 13 }}>
      <summary style={{ cursor: "pointer", color: "#a3a3a3" }}>Thinking ({reasoning.length})</summary>
      {reasoning.map((seg) => (
        <div key={seg.id} style={{ marginTop: 8, color: "#737373", whiteSpace: "pre-wrap" }}>
          {seg.text}
          {seg.status === "streaming" && <span style={{ color: "#fbbf24" }}> ...</span>}
        </div>
      ))}
    </details>
  );
}
