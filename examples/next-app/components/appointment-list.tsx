import { StatusPill } from "./status-pill";

interface Appointment {
  patientName: string;
  mrn: string;
  scheduledFor: string;
  reason: string;
  provider: string;
  status: string;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AppointmentList({
  title,
  appointments,
}: {
  title?: string;
  appointments: Appointment[];
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      {title && <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>}
      <div style={{ borderRadius: 8, border: "1px solid #222", overflow: "hidden" }}>
        {appointments.map((a, i) => (
          <div
            key={`${a.mrn}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 14px",
              borderTop: i === 0 ? "none" : "1px solid #1a1a1a",
              backgroundColor: "#111",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: "#ededed" }}>
                {a.patientName} <span style={{ color: "#666", fontWeight: 400 }}>· {a.reason}</span>
              </span>
              <span style={{ fontSize: 12, color: "#888" }}>
                {formatWhen(a.scheduledFor)} · {a.provider}
              </span>
            </div>
            <StatusPill status={a.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
