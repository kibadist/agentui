const variantStyles: Record<string, { bg: string; color: string }> = {
  info: { bg: "#1e3a5f", color: "#60a5fa" },
  success: { bg: "#14532d", color: "#4ade80" },
  warning: { bg: "#713f12", color: "#fbbf24" },
  error: { bg: "#7f1d1d", color: "#f87171" },
};

export function StatusBadge({
  label,
  variant = "info",
}: {
  label: string;
  variant?: "info" | "success" | "warning" | "error";
}) {
  const style = variantStyles[variant] ?? variantStyles.info;
  return (
    <span
      style={{
        display: "inline-block",
        marginBottom: 16,
        padding: "4px 12px",
        borderRadius: 9999,
        fontSize: 13,
        fontWeight: 500,
        backgroundColor: style.bg,
        color: style.color,
      }}
    >
      {label}
    </span>
  );
}
