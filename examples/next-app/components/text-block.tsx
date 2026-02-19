export function TextBlock({ title, body }: { title?: string; body: string }) {
  return (
    <div style={{ marginBottom: 16, padding: 16, backgroundColor: "#111", borderRadius: 8 }}>
      {title && <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>}
      <div style={{ whiteSpace: "pre-wrap", color: "#ccc", lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}
