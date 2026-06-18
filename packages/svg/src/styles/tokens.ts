// ─── Styling system: design tokens + base component CSS ──────────────────────
//
// Theming is done entirely through CSS custom properties on `--agentui-*`.
// Consumers override them at any level above (or on) the host element:
//
//   agentui-workflow-canvas { --agentui-accent: #0ea5e9; }
//   :root { --agentui-bg: #0b1020; --agentui-fg: #e5e7eb; }
//
// Because custom properties inherit through the shadow boundary, a single rule
// on an ancestor themes every component. Each component injects BASE_CSS plus
// its own component-scoped CSS into its shadow root via a <style> element
// (constructable stylesheets are avoided for jsdom/test compatibility).

/** Default token values, declared on :host so every component is self-contained. */
export const TOKENS_CSS = /* css */ `
:host {
  /* Surfaces */
  --agentui-bg: #ffffff;
  --agentui-surface: #f8fafc;
  --agentui-surface-2: #f1f5f9;
  --agentui-fg: #0f172a;
  --agentui-fg-muted: #64748b;
  --agentui-border: #e2e8f0;

  /* Brand / accent */
  --agentui-accent: #6366f1;
  --agentui-accent-contrast: #ffffff;

  /* Status palette */
  --agentui-status-idle: #94a3b8;
  --agentui-status-planning: #8b5cf6;
  --agentui-status-running: #0ea5e9;
  --agentui-status-waiting: #f59e0b;
  --agentui-status-success: #22c55e;
  --agentui-status-failed: #ef4444;
  --agentui-status-skipped: #cbd5e1;
  --agentui-status-blocked: #f97316;

  /* Geometry */
  --agentui-radius: 10px;
  --agentui-radius-sm: 6px;
  --agentui-stroke: 1.5px;
  --agentui-stroke-strong: 2.5px;
  --agentui-space: 12px;
  --agentui-space-sm: 6px;

  /* Typography */
  --agentui-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --agentui-font-mono: ui-monospace, "SFMono-Regular", "Menlo", monospace;
  --agentui-font-size: 13px;
  --agentui-font-size-sm: 11px;

  /* Focus + selection */
  --agentui-focus-ring: #6366f1;
  --agentui-focus-ring-width: 3px;
  --agentui-selected-ring: #4338ca;

  /* Elevation (used by CSS box-shadow on HTML overlays) */
  --agentui-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 4px 12px rgba(15, 23, 42, 0.08);
}
`;

/** Shared base CSS applied inside every component's shadow root. */
export const BASE_CSS = /* css */ `
:host {
  display: block;
  position: relative;
  box-sizing: border-box;
  color: var(--agentui-fg);
  font-family: var(--agentui-font);
  font-size: var(--agentui-font-size);
  background: var(--agentui-bg);
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }

svg { display: block; width: 100%; height: 100%; overflow: visible; }
svg text { font-family: var(--agentui-font); fill: var(--agentui-fg); }

/* Theme the glow filter's flood through CSS, where var() resolves (it does not
   resolve as an XML presentation attribute). Tracks --agentui-accent. */
.agentui-glow-flood { flood-color: var(--agentui-accent, #6366f1); }

/* Interactive scene parts. Focus ring is drawn with outline so it works for
   both HTML and SVG focus targets in supporting browsers. */
[data-activate] { cursor: pointer; outline: none; }
[data-activate]:focus-visible {
  outline: var(--agentui-focus-ring-width) solid var(--agentui-focus-ring);
  outline-offset: 2px;
}
[aria-disabled="true"] { cursor: default; opacity: 0.5; }

/* Status color helper classes — map a status to a CSS variable. */
.status-idle { --status: var(--agentui-status-idle); }
.status-planning { --status: var(--agentui-status-planning); }
.status-running { --status: var(--agentui-status-running); }
.status-waiting { --status: var(--agentui-status-waiting); }
.status-success { --status: var(--agentui-status-success); }
.status-failed { --status: var(--agentui-status-failed); }
.status-skipped { --status: var(--agentui-status-skipped); }
.status-blocked { --status: var(--agentui-status-blocked); }

/* Empty / loading / error overlays (HTML, centered). */
.agentui-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--agentui-space-sm);
  color: var(--agentui-fg-muted);
  text-align: center;
  padding: var(--agentui-space);
}
.agentui-state[hidden] { display: none; }
`;

/** Map an AgentStatus string to its CSS color variable reference. */
export function statusColorVar(status: string | undefined): string {
  const known = [
    "idle",
    "planning",
    "running",
    "waiting",
    "success",
    "failed",
    "skipped",
    "blocked",
  ];
  const s = status && known.includes(status) ? status : "idle";
  return `var(--agentui-status-${s})`;
}
