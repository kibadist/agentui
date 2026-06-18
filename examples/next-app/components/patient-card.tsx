import { StatusPill } from "./status-pill";

export function PatientCard({
  name,
  mrn,
  age,
  sex,
  condition,
  status,
}: {
  name: string;
  mrn: string;
  age: number;
  sex: string;
  condition: string;
  status: string;
}) {
  return (
    <div
      style={{
        marginBottom: 16,
        padding: 16,
        backgroundColor: "#111",
        borderRadius: 8,
        border: "1px solid #333",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 17 }}>{name}</h3>
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 16px", color: "#aaa", fontSize: 13 }}>
        <span><span style={{ color: "#666" }}>MRN</span> {mrn}</span>
        <span><span style={{ color: "#666" }}>Age</span> {age}</span>
        <span><span style={{ color: "#666" }}>Sex</span> {sex}</span>
      </div>
      <div style={{ marginTop: 10, color: "#ccc", fontSize: 14 }}>
        <span style={{ color: "#666", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Primary condition
        </span>
        <div>{condition}</div>
      </div>
    </div>
  );
}
