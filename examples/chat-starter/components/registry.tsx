import { createRegistry } from "@kibadist/agentui-react";

function MessageBubble({ from, text }: { from: "user" | "agent"; text: string }) {
  const isUser = from === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", margin: "8px 0" }}>
      <div
        style={{
          maxWidth: "70%",
          padding: "10px 14px",
          borderRadius: 12,
          background: isUser ? "#1d4ed8" : "#262626",
          color: "#fafafa",
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  return <p style={{ color: "#a3a3a3", margin: "8px 0" }}>{text}</p>;
}

export const registry = createRegistry({
  "chat.message": { component: MessageBubble },
  "chat.text": { component: TextBlock },
});
