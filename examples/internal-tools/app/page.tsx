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
import { ClientsTable } from "@/components/clients-table";
import { registry } from "@/components/registry";

const API_BASE = "";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/agent/session`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => setSessionId(d.sessionId));
  }, []);
  if (!sessionId) return <div style={{ padding: 40 }}>Connecting...</div>;
  return <App sessionId={sessionId} />;
}

function App({ sessionId }: { sessionId: string }) {
  const sseUrl = `${API_BASE}/api/agent/${sessionId}/stream`;
  const actionUrl = `${API_BASE}/api/agent/${sessionId}/action`;
  const { state, status, store } = useAgentStream({ url: sseUrl, sessionId });

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

  const summarizeClient = useCallback(
    (client: { id: string; name: string; status: string; mrr: number }) => {
      sender({
        v: 1,
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        sessionId,
        kind: "action",
        type: "action.submit",
        name: "client.summarize",
        payload: { client },
      });
    },
    [sender, sessionId],
  );

  return (
    <AgentStateProvider store={store}>
      <AgentActionProvider sender={sender}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", minHeight: "100vh" }}>
          {/* Main app: clients table */}
          <main style={{ padding: 24, borderRight: "1px solid #1f1f1f" }}>
            <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Clients</h1>
            <p style={{ fontSize: 13, color: "#a3a3a3", marginBottom: 20 }}>
              Click any row to ask the agent for a summary.
            </p>
            <ClientsTable onSelect={summarizeClient} />
          </main>

          {/* Side panel: agent */}
          <aside style={{ padding: 20, background: "#0d0d0d", overflowY: "auto" }}>
            <header style={{ paddingBottom: 12, borderBottom: "1px solid #262626", marginBottom: 16 }}>
              <h2 style={{ fontSize: 14, margin: 0, color: "#e5e5e5" }}>Agent</h2>
              <span style={{ fontSize: 11, color: "#737373" }}>{status}</span>
            </header>
            {state.nodes.length === 0 && (
              <p style={{ fontSize: 13, color: "#737373" }}>
                Select a client to see insights here.
              </p>
            )}
            <AgentRenderer state={state} registry={registry} />
          </aside>
        </div>
      </AgentActionProvider>
    </AgentStateProvider>
  );
}
