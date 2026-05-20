"use client";

import { useState } from "react";

interface Client {
  id: string;
  name: string;
  status: "active" | "lead" | "churned";
  mrr: number;
}

const CLIENTS: Client[] = [
  { id: "c1", name: "Acme Inc.", status: "active", mrr: 12_000 },
  { id: "c2", name: "Globex Corp", status: "active", mrr: 8_400 },
  { id: "c3", name: "Initech LLC", status: "lead", mrr: 0 },
  { id: "c4", name: "Umbrella Co", status: "churned", mrr: 0 },
  { id: "c5", name: "Wayne Enterprises", status: "active", mrr: 25_000 },
];

const STATUS_COLORS = {
  active: "#4ade80",
  lead: "#fbbf24",
  churned: "#737373",
} as const;

export function ClientsTable({ onSelect }: { onSelect: (c: Client) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: "left", color: "#a3a3a3", borderBottom: "1px solid #262626" }}>
          <th style={{ padding: "10px 12px" }}>Client</th>
          <th style={{ padding: "10px 12px" }}>Status</th>
          <th style={{ padding: "10px 12px", textAlign: "right" }}>MRR</th>
        </tr>
      </thead>
      <tbody>
        {CLIENTS.map((c) => (
          <tr
            key={c.id}
            onClick={() => {
              setSelected(c.id);
              onSelect(c);
            }}
            style={{
              cursor: "pointer",
              background: selected === c.id ? "#1f2937" : "transparent",
              borderBottom: "1px solid #1f1f1f",
            }}
          >
            <td style={{ padding: "10px 12px" }}>{c.name}</td>
            <td style={{ padding: "10px 12px" }}>
              <span style={{ color: STATUS_COLORS[c.status] }}>{c.status}</span>
            </td>
            <td style={{ padding: "10px 12px", textAlign: "right" }}>
              {c.mrr > 0 ? `$${c.mrr.toLocaleString()}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
