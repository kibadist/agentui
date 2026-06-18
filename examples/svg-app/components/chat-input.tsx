"use client";

import { useState, type FormEvent } from "react";

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        padding: 16,
        borderTop: "1px solid #222",
        display: "flex",
        gap: 8,
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Send a message..."
        disabled={disabled}
        style={{
          flex: 1,
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #333",
          backgroundColor: "#111",
          color: "#ededed",
          fontSize: 14,
          outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        style={{
          padding: "10px 20px",
          borderRadius: 8,
          border: "none",
          backgroundColor: disabled || !value.trim() ? "#222" : "#3b82f6",
          color: disabled || !value.trim() ? "#666" : "#fff",
          fontSize: 14,
          fontWeight: 500,
          cursor: disabled || !value.trim() ? "default" : "pointer",
        }}
      >
        Send
      </button>
    </form>
  );
}
