interface Medication {
  name: string;
  dose: string;
  frequency: string;
  startedOn: string;
}

export function MedicationList({
  title,
  medications,
}: {
  title?: string;
  medications: Medication[];
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      {title && <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>}
      <div style={{ borderRadius: 8, border: "1px solid #222", overflow: "hidden" }}>
        {medications.map((m, i) => (
          <div
            key={`${m.name}-${i}`}
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 14px",
              borderTop: i === 0 ? "none" : "1px solid #1a1a1a",
              backgroundColor: "#111",
              fontSize: 14,
            }}
          >
            <span style={{ color: "#ededed", fontWeight: 500 }}>{m.name}</span>
            <span style={{ color: "#aaa" }}>
              {m.dose} · {m.frequency}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
