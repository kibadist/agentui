import { createRegistry } from "@kibadist/agentui-react";

function InsightCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ background: "#171717", border: "1px solid #262626", borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e5e5", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#a3a3a3" }}>{body}</div>
    </div>
  );
}

function AgentMessage({ text }: { text: string }) {
  return (
    <div style={{ padding: "10px 12px", background: "#1f1f1f", borderRadius: 8, marginBottom: 10, fontSize: 13, color: "#fafafa" }}>
      {text}
    </div>
  );
}

export const registry = createRegistry({
  "tool.insight-card": { component: InsightCard },
  "tool.agent-msg": { component: AgentMessage },
});
