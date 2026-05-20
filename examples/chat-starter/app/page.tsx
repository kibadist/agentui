"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActionEvent } from "@kibadist/agentui-protocol";
import {
  useAgentStream,
  AgentRenderer,
  AgentStateProvider,
  AgentActionProvider,
  type ActionSender,
} from "@kibadist/agentui-react";
import { registry } from "@/components/registry";

const API_BASE = ""; // same-origin

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/agent/session`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => setSessionId(d.sessionId));
  }, []);

  if (!sessionId) return <div style={{ padding: 40 }}>Connecting...</div>;
  return <Chat sessionId={sessionId} />;
}

function Chat({ sessionId }: { sessionId: string }) {
  const sseUrl = `${API_BASE}/api/agent/${sessionId}/stream`;
  const actionUrl = `${API_BASE}/api/agent/${sessionId}/action`;
  const { state, status, store } = useAgentStream({ url: sseUrl, sessionId });
  const [text, setText] = useState("");

  const sender: ActionSender = useCallback(
    async (action: ActionEvent) => {
      await fetch(actionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
    },
    [actionUrl],
  );

  const send = useCallback(() => {
    if (!text.trim()) return;
    sender({
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      kind: "action",
      type: "action.submit",
      name: "chat.send",
      payload: { message: text },
    });
    setText("");
  }, [text, sender, sessionId]);

  return (
    <AgentStateProvider store={store}>
      <AgentActionProvider sender={sender}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: 24, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
          <header style={{ padding: "12px 0", borderBottom: "1px solid #262626", marginBottom: 16 }}>
            <h1 style={{ fontSize: 18, margin: 0 }}>chat starter</h1>
            <span style={{ fontSize: 12, color: "#a3a3a3" }}>{status}</span>
          </header>
          <main style={{ flex: 1, overflow: "auto" }}>
            {state.nodes.length === 0 && <p style={{ color: "#737373" }}>Send a message to start.</p>}
            <AgentRenderer state={state} registry={registry} />
          </main>
          <footer style={{ display: "flex", gap: 8, padding: "16px 0", borderTop: "1px solid #262626" }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Type a message..."
              style={{ flex: 1, padding: "10px 14px", background: "#171717", border: "1px solid #262626", borderRadius: 8, color: "#fafafa" }}
            />
            <button
              onClick={send}
              disabled={status !== "open" || !text.trim()}
              style={{ padding: "10px 20px", background: "#1d4ed8", border: 0, borderRadius: 8, color: "#fff", cursor: "pointer" }}
            >
              Send
            </button>
          </footer>
        </div>
      </AgentActionProvider>
    </AgentStateProvider>
  );
}
