export function InfoCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: string;
}) {
  return (
    <div
      style={{
        marginBottom: 16,
        padding: 16,
        backgroundColor: "#111",
        borderRadius: 8,
        borderLeft: "3px solid #3b82f6",
      }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>
        {icon && <span style={{ marginRight: 8 }}>{icon}</span>}
        {title}
      </h3>
      <p style={{ margin: 0, color: "#aaa", lineHeight: 1.5 }}>{description}</p>
    </div>
  );
}
