const palette: Record<string, { bg: string; color: string }> = {
  active: { bg: "#14532d", color: "#4ade80" },
  inactive: { bg: "#3f3f46", color: "#a1a1aa" },
  scheduled: { bg: "#1e3a5f", color: "#60a5fa" },
  completed: { bg: "#14532d", color: "#4ade80" },
  cancelled: { bg: "#7f1d1d", color: "#f87171" },
  abnormal: { bg: "#7f1d1d", color: "#f87171" },
  normal: { bg: "#14532d", color: "#4ade80" },
};

/** Small rounded status label, colored by a known status keyword. */
export function StatusPill({ status }: { status: string }) {
  const style = palette[status] ?? palette.inactive;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 500,
        textTransform: "capitalize",
        backgroundColor: style.bg,
        color: style.color,
      }}
    >
      {status}
    </span>
  );
}
