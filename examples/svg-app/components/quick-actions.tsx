"use client";

/**
 * Quick-action prompts that kick off a real, instrumented agent investigation.
 * The agent runs live tool calls over the SQLite incident data; the SVG
 * components are rendered from its actual execution.
 */
const QUICK_ACTIONS = [
  "checkout-service is failing — investigate and recommend a fix",
  "What changed recently across our services?",
  "Why is the error rate on payments-api elevated?",
  "Find the bad deploy and propose a rollback",
  "Triage the current incident end to end",
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
