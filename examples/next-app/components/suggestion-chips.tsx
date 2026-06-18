"use client";

/** DB-related starter prompts shown above the input. */
const SUGGESTIONS = [
  "List all patients",
  "Today's appointments",
  "Patients with abnormal vitals",
  "Patients with diabetes",
  "Summarize patient MRN-1003",
];

export function SuggestionChips({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 16px 12px" }}>
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          onClick={() => onSend(s)}
          disabled={disabled}
          style={{
            padding: "6px 12px",
            borderRadius: 9999,
            border: "1px solid #333",
            backgroundColor: disabled ? "#161616" : "#1a1a1a",
            color: disabled ? "#555" : "#cbd5e1",
            fontSize: 13,
            cursor: disabled ? "default" : "pointer",
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
