import type { ReactNode } from "react";

export const metadata = {
  title: "AgentUI internal tools",
  description: "Agent embedded as a side panel in a CRUD app",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0a0a0a", color: "#e5e5e5" }}>
        {children}
      </body>
    </html>
  );
}
