"use client";

import { type CSSProperties } from "react";

interface ScrubberProps {
  /** Total number of recorded events. */
  total: number;
  /** Current scrub position. `total` means "live". */
  value: number;
  onChange: (next: number) => void;
}

const wrap: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderTop: "1px solid #2a2a30",
  fontSize: 11,
  color: "#a9a9b3",
};

const input: CSSProperties = {
  flex: 1,
  accentColor: "#7dd3fc",
};

export function Scrubber({ total, value, onChange }: ScrubberProps) {
  const live = value >= total;
  return (
    <div style={wrap}>
      <button
        type="button"
        onClick={() => onChange(total)}
        style={{
          background: live ? "#1f3a52" : "transparent",
          color: live ? "#7dd3fc" : "#a9a9b3",
          border: "1px solid #2a2a30",
          borderRadius: 4,
          padding: "2px 6px",
          fontSize: 10,
          cursor: "pointer",
        }}
        aria-label="Jump to live"
      >
        ●
      </button>
      <input
        type="range"
        min={0}
        max={total}
        value={Math.min(value, total)}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        style={input}
        disabled={total === 0}
      />
      <span style={{ minWidth: 84, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {live ? "live" : `${value} / ${total}`}
      </span>
    </div>
  );
}
