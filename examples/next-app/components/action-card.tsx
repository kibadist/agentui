"use client";

import { useAgentAction } from "@kibadist/agentui-react";
import type { ActionEvent } from "@kibadist/agentui-protocol";

interface ActionDef {
  name: string;
  label: string;
}

export function ActionCard({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: ActionDef[];
}) {
  const sendAction = useAgentAction();

  const handleClick = (action: ActionDef) => {
    const event: ActionEvent = {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId: "",
      kind: "action",
      type: "action.submit",
      name: action.name,
      payload: { label: action.label },
    };
    sendAction(event);
  };

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 16,
        backgroundColor: "#111",
        borderRadius: 8,
        border: "1px solid #333",
      }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>
      <p style={{ margin: "0 0 12px", color: "#aaa", lineHeight: 1.5 }}>{description}</p>
      <div style={{ display: "flex", gap: 8 }}>
        {actions?.map((a) => (
          <button
            key={a.name}
            onClick={() => handleClick(a)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #444",
              backgroundColor: "#1a1a1a",
              color: "#ededed",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
