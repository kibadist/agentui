"use client";

import { useEffect, useState } from "react";

interface Toast {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  ts: string;
}

const levelColors: Record<string, { bg: string; border: string }> = {
  info: { bg: "#0c1929", border: "#1e40af" },
  success: { bg: "#0a1f0f", border: "#166534" },
  warning: { bg: "#1a1408", border: "#854d0e" },
  error: { bg: "#1f0a0a", border: "#991b1b" },
};

export function ToastList({ toasts }: { toasts: Toast[] }) {
  const [visible, setVisible] = useState<string[]>([]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    if (visible.includes(latest.id)) return;

    setVisible((prev) => [...prev, latest.id]);

    const timer = setTimeout(() => {
      setVisible((prev) => prev.filter((id) => id !== latest.id));
    }, 4000);

    return () => clearTimeout(timer);
  }, [toasts]);

  const activeToasts = toasts.filter((t) => visible.includes(t.id));
  if (activeToasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 50,
      }}
    >
      {activeToasts.map((t) => {
        const colors = levelColors[t.level] ?? levelColors.info;
        return (
          <div
            key={t.id}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              backgroundColor: colors.bg,
              borderLeft: `3px solid ${colors.border}`,
              fontSize: 13,
              color: "#ededed",
              maxWidth: 320,
            }}
          >
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
