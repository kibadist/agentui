/**
 * Reference ranges — mirrors VITALS_RANGES in the backend's clinic-db.ts.
 * The panel flags out-of-range values itself, so the agent only sends raw
 * numbers.
 */
const RANGES = {
  heartRate: { min: 60, max: 100, label: "Heart rate", unit: "bpm" },
  systolic: { min: 90, max: 130, label: "Systolic", unit: "mmHg" },
  diastolic: { min: 60, max: 85, label: "Diastolic", unit: "mmHg" },
  tempC: { min: 36.1, max: 37.5, label: "Temp", unit: "°C" },
  spo2: { min: 95, max: 100, label: "SpO₂", unit: "%" },
} as const;

type MetricKey = keyof typeof RANGES;

export function VitalsPanel({
  patientName,
  recordedAt,
  heartRate,
  systolic,
  diastolic,
  tempC,
  spo2,
}: {
  patientName: string;
  recordedAt: string;
  heartRate: number;
  systolic: number;
  diastolic: number;
  tempC: number;
  spo2: number;
}) {
  const values: Record<MetricKey, number> = { heartRate, systolic, diastolic, tempC, spo2 };
  const recorded = new Date(recordedAt);
  const when = isNaN(recorded.getTime()) ? recordedAt : recorded.toLocaleString();

  return (
    <div style={{ marginBottom: 16, padding: 16, backgroundColor: "#111", borderRadius: 8, border: "1px solid #222" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{patientName} — latest vitals</h3>
        <span style={{ fontSize: 12, color: "#666" }}>{when}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8 }}>
        {(Object.keys(RANGES) as MetricKey[]).map((key) => {
          const range = RANGES[key];
          const value = values[key];
          const abnormal = value < range.min || value > range.max;
          return (
            <div
              key={key}
              style={{
                padding: "10px 12px",
                borderRadius: 6,
                backgroundColor: abnormal ? "#1f0a0a" : "#161616",
                border: `1px solid ${abnormal ? "#991b1b" : "#222"}`,
              }}
            >
              <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {range.label}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: abnormal ? "#f87171" : "#ededed" }}>
                {value}
                <span style={{ fontSize: 11, fontWeight: 400, color: "#888", marginLeft: 3 }}>{range.unit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
