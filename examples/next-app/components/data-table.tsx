export function DataTable({
  title,
  columns,
  rows,
}: {
  title?: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      {title && <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{title}</h3>}
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #222" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 14,
          }}
        >
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    backgroundColor: "#161616",
                    borderBottom: "1px solid #222",
                    fontWeight: 600,
                    color: "#aaa",
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid #1a1a1a",
                      color: "#ccc",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
