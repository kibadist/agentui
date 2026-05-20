import { createRegistry } from "@kibadist/agentui-react";

function Message({ from, text }: { from: "user" | "agent"; text: string }) {
  const isUser = from === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", margin: "6px 0" }}>
      <div
        style={{
          maxWidth: "75%",
          padding: "10px 14px",
          borderRadius: 12,
          background: isUser ? "#1d4ed8" : "#1f1f1f",
          color: "#fafafa",
          whiteSpace: "pre-wrap",
          fontSize: 14,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function KBSnippet({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: 12, margin: "8px 0", fontSize: 13 }}>
      <div style={{ fontWeight: 600, color: "#93c5fd", marginBottom: 4 }}>{title}</div>
      <div style={{ color: "#cbd5e1" }}>{body}</div>
    </div>
  );
}

export const registry = createRegistry({
  "support.message": { component: Message },
  "support.kb-snippet": { component: KBSnippet },
});
