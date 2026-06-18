"use client";

/** Quick-action prompts shown above the input for the observability demo. */
const QUICK_ACTIONS = [
  "Visualize the deploy investigation",
  "Show the patient intake run",
  "Show the competitor research run",
  "Which runs are recorded?",
  "Show me a run with a pending approval",
];

export function QuickActions({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 16px 12px" }}>
      {QUICK_ACTIONS.map((s) => (
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
