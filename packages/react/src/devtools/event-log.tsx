"use client";

import { useMemo, type CSSProperties } from "react";
import type { RecordedEvent } from "./recorder.js";
import { categoryOf, summarize, type Category } from "./summarize.js";

/** Set of which categories are checked. */
export type EventLogFilters = Record<Exclude<Category, "other">, boolean>;

export interface EventLogProps {
  events: RecordedEvent[];
  /** Current scrub position (events.length === live). */
  scrubPos: number;
  /** Move scrubber to N (event seq + 1, i.e. state after that event). */
  onScrub: (next: number) => void;
  filters: EventLogFilters;
  onFiltersChange: (next: EventLogFilters) => void;
  search: string;
  onSearchChange: (s: string) => void;
}

const wrap: CSSProperties = { display: "flex", flexDirection: "column", height: "100%" };
const head: CSSProperties = {
  padding: "6px 10px",
  fontSize: 11,
  color: "#a9a9b3",
  borderBottom: "1px solid #1a1a20",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const list: CSSProperties = { overflowY: "auto", flex: 1, fontSize: 11 };
const row: CSSProperties = {
  padding: "3px 10px",
  borderBottom: "1px solid #16161a",
  display: "grid",
  gridTemplateColumns: "40px 80px 1fr",
  gap: 6,
  cursor: "pointer",
  fontVariantNumeric: "tabular-nums",
};
const rowSel: CSSProperties = { ...row, background: "#1f3a52" };

const opColor: Record<Category, string> = {
  ui: "#7dd3fc",
  tool: "#fbbf77",
  reasoning: "#c4b5fd",
  optimistic: "#86efac",
  session: "#f9a8d4",
  other: "#a9a9b3",
};

export function EventLog({
  events,
  scrubPos,
  onScrub,
  filters,
  onFiltersChange,
  search,
  onSearchChange,
}: EventLogProps) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      const cat = categoryOf(e.action);
      if (cat === "other") return true;
      if (!filters[cat]) return false;
      if (q && !`${e.action.op} ${summarize(e.action)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, filters, search]);

  return (
    <div style={wrap}>
      <div style={head}>
        <div>Event Log ({filtered.length}/{events.length})</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(Object.keys(filters) as Array<keyof EventLogFilters>).map((cat) => (
            <label key={cat} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
              <input
                type="checkbox"
                checked={filters[cat]}
                onChange={(e) =>
                  onFiltersChange({ ...filters, [cat]: e.currentTarget.checked })
                }
              />
              <span style={{ color: opColor[cat] }}>{cat}</span>
            </label>
          ))}
        </div>
        <input
          type="text"
          placeholder="search…"
          value={search}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          style={{
            background: "#15151a",
            border: "1px solid #2a2a30",
            color: "#e6e6ea",
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 11,
          }}
        />
      </div>
      <div style={list}>
        {filtered.map((e) => {
          const cat = categoryOf(e.action);
          const sel = scrubPos === e.seq + 1;
          return (
            <div
              key={e.seq}
              style={sel ? rowSel : row}
              onClick={() => onScrub(e.seq + 1)}
              role="button"
              tabIndex={0}
            >
              <span style={{ color: "#a9a9b3" }}>#{e.seq}</span>
              <span style={{ color: opColor[cat] }}>{e.action.op}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {summarize(e.action)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
