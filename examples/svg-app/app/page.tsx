"use client";

import { useEffect, useState, useCallback } from "react";
import type { ActionEvent } from "@kibadist/agentui-protocol";
import {
  useAgentStream,
  AgentRenderer,
  AgentActionProvider,
  AgentStateProvider,
  type ActionSender,
} from "@kibadist/agentui-react";
import { AgentDevTools } from "@kibadist/agentui-react/devtools";
import { registry } from "@/components/registry";
import { ChatInput } from "@/components/chat-input";
import { ToastList } from "@/components/toast-list";
import { QuickActions } from "@/components/quick-actions";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3003";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create session on mount
  useEffect(() => {
    fetch(`${API_BASE}/agent/session`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => setSessionId(data.sessionId))
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <h2>Connection error</h2>
        <p style={{ color: "#f87171" }}>{error}</p>
        <p style={{ color: "#888" }}>
          Make sure the svg-api is running on {API_BASE}
        </p>
      </div>
    );
  }

  if (!sessionId) {
    return <div style={{ padding: 40, color: "#888" }}>Connecting...</div>;
  }

  return <AgentSession sessionId={sessionId} />;
}

function AgentSession({ sessionId }: { sessionId: string }) {
  const sseUrl = `${API_BASE}/agent/${sessionId}/stream`;
  const actionUrl = `${API_BASE}/agent/${sessionId}/action`;

  const { state, status, store } = useAgentStream({ url: sseUrl, sessionId });

  const sender: ActionSender = useCallback(
    async (action: ActionEvent) => {
      // Stamp the live session id onto every action. Components rendered by
      // AgentRenderer (the SVG views) build events with an empty sessionId
      // because they don't know it; the server validates it must be non-empty.
      await fetch(actionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...action, sessionId }),
      });
    },
    [actionUrl, sessionId],
  );

  const sendMessage = useCallback(
    (message: string) => {
      const action: ActionEvent = {
        v: 1,
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        sessionId,
        kind: "action",
        type: "action.submit",
        name: "chat.send",
        payload: { message },
      };
      sender(action);
    },
    [sender, sessionId],
  );

  return (
    <AgentStateProvider store={store}>
      <AgentActionProvider sender={sender}>
        <div
          style={{
            maxWidth: 800,
            margin: "0 auto",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            ["--agentui-accent" as string]: "#3b82f6",
          }}
        >
          {/* Header */}
          <header
            style={{
              padding: "16px 24px",
              borderBottom: "1px solid #222",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <h1 style={{ fontSize: 18, margin: 0 }}>🔭 Agent Observability</h1>
            <span
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 9999,
                backgroundColor:
                  status === "open"
                    ? "#166534"
                    : status === "connecting"
                      ? "#854d0e"
                      : "#7f1d1d",
                color:
                  status === "open"
                    ? "#4ade80"
                    : status === "connecting"
                      ? "#fbbf24"
                      : "#f87171",
              }}
            >
              {status}
            </span>
          </header>

          {/* Rendered agent UI */}
          <main style={{ flex: 1, padding: 24, overflow: "auto" }}>
            {state.nodes.length === 0 && (
              <p style={{ color: "#666" }}>
                Ask the agent to investigate an incident. It runs real tool calls
                over the service data, and the workflow, tool timeline, state
                machine, memory map, and approval gate are rendered live from its
                actual execution. Tap a quick action below to start.
              </p>
            )}
            <AgentRenderer state={state} registry={registry} />
          </main>

          {/* Toasts */}
          <ToastList toasts={state.toasts} />

          {/* Quick actions + input */}
          <QuickActions onSend={sendMessage} disabled={status !== "open"} />
          <ChatInput onSend={sendMessage} disabled={status !== "open"} />

          {/* DevTools */}
          <AgentDevTools position="tr" defaultCollapsed />
        </div>
      </AgentActionProvider>
    </AgentStateProvider>
  );
}
