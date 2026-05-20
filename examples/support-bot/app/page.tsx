"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionEvent } from "@kibadist/agentui-protocol";
import {
  useAgentStream,
  AgentRenderer,
  AgentStateProvider,
  AgentActionProvider,
  type ActionSender,
} from "@kibadist/agentui-react";
import { registry } from "@/components/registry";
import { ReasoningPanel } from "@/components/reasoning-panel";
import { ToolCallsList } from "@/components/tool-calls";

const API_BASE = "";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/agent/session`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => setSessionId(d.sessionId));
  }, []);
  if (!sessionId) return <div style={{ padding: 40 }}>Connecting...</div>;
  return <SupportBot sessionId={sessionId} />;
}

function SupportBot({ sessionId }: { sessionId: string }) {
  const sseUrl = `${API_BASE}/api/agent/${sessionId}/stream`;
  const actionUrl = `${API_BASE}/api/agent/${sessionId}/action`;
  const { state, status, store } = useAgentStream({ url: sseUrl, sessionId });
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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

  const askQuestion = useCallback(() => {
    if (!text.trim()) return;
    sender({
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      kind: "action",
      type: "action.submit",
      name: "support.ask",
      payload: { question: text },
    });
    setText("");
  }, [text, sender, sessionId]);

  const uploadFile = useCallback(() => {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    sender({
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      kind: "action",
      type: "action.submit",
      name: "support.upload",
      payload: { filename: f.name, size: f.size },
    });
    if (fileRef.current) fileRef.current.value = "";
  }, [sender, sessionId]);

  return (
    <AgentStateProvider store={store}>
      <AgentActionProvider sender={sender}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: 24, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
          <header style={{ paddingBottom: 12, borderBottom: "1px solid #262626" }}>
            <h1 style={{ fontSize: 18, margin: 0 }}>support bot</h1>
            <span style={{ fontSize: 12, color: "#a3a3a3" }}>status: {status}</span>
          </header>
          <main style={{ flex: 1, overflow: "auto", paddingTop: 16 }}>
            {state.nodes.length === 0 && (
              <p style={{ color: "#737373" }}>Ask a question. The agent will search the KB and answer.</p>
            )}
            <AgentRenderer state={state} registry={registry} />
            <ToolCallsList />
            <ReasoningPanel />
          </main>
          <footer style={{ paddingTop: 16, borderTop: "1px solid #262626", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && askQuestion()}
                placeholder="How do I reset my password?"
                style={{ flex: 1, padding: "10px 14px", background: "#171717", border: "1px solid #262626", borderRadius: 8, color: "#fafafa" }}
              />
              <button
                onClick={askQuestion}
                disabled={status !== "open"}
                style={{ padding: "10px 18px", background: "#1d4ed8", border: 0, borderRadius: 8, color: "#fff", cursor: "pointer" }}
              >
                Ask
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#a3a3a3" }}>
              <input type="file" ref={fileRef} />
              <button
                onClick={uploadFile}
                style={{ padding: "6px 12px", background: "#262626", border: "1px solid #404040", borderRadius: 6, color: "#fafafa", cursor: "pointer", fontSize: 12 }}
              >
                Upload (stub)
              </button>
            </div>
          </footer>
        </div>
      </AgentActionProvider>
    </AgentStateProvider>
  );
}
