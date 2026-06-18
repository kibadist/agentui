import type { UIEvent } from "@kibadist/agentui-protocol";

/**
 * Drives the live SVG observability components for ONE agent turn from the
 * agent's REAL tool calls. The agent.service wraps each incident tool's
 * `execute` to call `start()`/`end()` here; after every start and end we
 * (re)emit the four live components with STABLE keys (first time as ui.append,
 * thereafter as ui.replace). `propose_rollback` additionally emits a
 * review-checkpoint.
 *
 * Pure of NestJS / the AI SDK so a test can drive it directly: pass an `emit`
 * spy, call `start`/`end`/`checkpoint`, and assert the captured events.
 */

export interface RunStep {
  id: string;
  key: string; // stable component-node key: `${tool}-${n}`
  label: string;
  tool: string;
  status: "running" | "success" | "failed";
  startedAt: number;
  durationMs?: number;
  argsSummary: string;
  detail?: string;
}

/** Partial UIEvent (no envelope) — the emit callback fills v/id/ts/sessionId. */
export type EmitFn = (partial: Record<string, unknown>) => void;

/** Human label for a tool name. */
const TOOL_LABELS: Record<string, string> = {
  list_services: "List services",
  get_deploys: "Get deploys",
  query_error_logs: "Query error logs",
  get_metrics: "Get metrics",
  propose_rollback: "Propose rollback",
};

/** Memory-map node type for a data source the agent pulled. */
const TOOL_SOURCE_TYPE: Record<string, string> = {
  list_services: "source",
  get_deploys: "source",
  query_error_logs: "source",
  get_metrics: "source",
  propose_rollback: "rule",
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

/** Short, single-line summary of tool args. */
export function summarizeArgs(args: unknown): string {
  if (args == null || typeof args !== "object") return "";
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return "(no args)";
  return entries
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

/** Short, single-line summary of a tool result. */
export function summarizeResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result.slice(0, 200);
  if (Array.isArray(result)) return `${result.length} row(s)`;
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    return Object.keys(obj).slice(0, 4).join(", ");
  }
  return String(result);
}

export class RunRecorder {
  readonly turn: number;
  readonly steps: RunStep[] = [];
  /** Keys this turn has appended (so re-emits use ui.replace). */
  private readonly appended = new Set<string>();
  private rollback: { service: string; toVersion: string; reason: string } | null = null;
  private counter = 0;
  private finalText: string | null = null;

  constructor(turn: number, private readonly emit: EmitFn) {
    this.turn = turn;
  }

  get wfKey(): string { return `wf-${this.turn}`; }
  get tlKey(): string { return `tl-${this.turn}`; }
  get smKey(): string { return `sm-${this.turn}`; }
  get mmKey(): string { return `mm-${this.turn}`; }
  get cpKey(): string { return `cp-${this.turn}`; }
  get sumKey(): string { return `sum-${this.turn}`; }

  /** Record a tool call START. Returns the step id for `end()`. */
  start(tool: string, args: unknown): string {
    const n = ++this.counter;
    const id = `${tool}-${n}`;
    this.steps.push({
      id,
      key: id,
      label: toolLabel(tool),
      tool,
      status: "running",
      startedAt: Date.now(),
      argsSummary: summarizeArgs(args),
    });
    this.emitLive();
    return id;
  }

  /** Record a tool call END (success or failure) and re-emit. */
  end(id: string, opts: { failed: boolean; result?: unknown }): void {
    const step = this.steps.find((s) => s.id === id);
    if (!step) return;
    step.status = opts.failed ? "failed" : "success";
    step.durationMs = Date.now() - step.startedAt;
    step.detail = opts.failed
      ? `Error: ${summarizeResult(opts.result) || "tool threw"}`
      : summarizeResult(opts.result);
    this.emitLive();
  }

  /** Record a proposed rollback and emit the review checkpoint. */
  checkpoint(service: string, toVersion: string, reason: string, summary: string): void {
    this.rollback = { service, toVersion, reason };
    this.append(this.cpKey, "review-checkpoint", {
      title: `Roll back ${service} to ${toVersion}?`,
      description: reason,
      level: "high",
      summary,
    });
    this.emitLive();
  }

  /** Whether a rollback was proposed this turn. */
  get proposedRollback(): boolean {
    return this.rollback != null;
  }

  /** Look up a step's detail for an inspect action. */
  stepDetail(id: string): string | null {
    const step = this.steps.find((s) => s.id === id);
    if (!step) return null;
    return step.detail ?? step.argsSummary ?? step.label;
  }

  /** The phase id the state machine should show as active right now. */
  private activePhase(): string {
    if (this.rollback) return "awaiting";
    if (this.finalText != null) return "resolved";
    if (this.steps.length === 0) return "planning";
    return "investigating";
  }

  /** Finalize the turn: emit/replace the summary text-block. */
  finish(text: string): void {
    this.finalText = text;
    this.append(this.sumKey, "text-block", {
      title: "Investigation summary",
      body: text || "Investigation complete.",
    });
    this.emitLive();
  }

  /** Re-emit all four live components from current state. */
  emitLive(): void {
    this.emitWorkflow();
    this.emitTimeline();
    this.emitStateMachine();
    this.emitMemoryMap();
  }

  private emitWorkflow(): void {
    const nodes: { id: string; label: string; sublabel?: string; status?: string }[] = [
      { id: "plan", label: "Plan", status: "success" },
      ...this.steps.map((s) => ({
        id: s.key,
        label: s.label,
        sublabel: s.tool,
        status: s.status,
      })),
      {
        id: "respond",
        label: "Respond",
        status: this.finalText != null ? "success" : "idle",
      },
    ];
    const seq = ["plan", ...this.steps.map((s) => s.key), "respond"];
    const edges = seq.slice(0, -1).map((from, i) => ({
      id: `wf-e-${i}`,
      from,
      to: seq[i + 1],
    }));
    this.append(this.wfKey, "workflow-canvas", {
      title: "Live agent run — workflow",
      nodes,
      edges,
    });
  }

  private emitTimeline(): void {
    const items = this.steps.map((s) => ({
      id: s.key,
      label: s.label,
      status: s.status,
      ...(s.durationMs != null ? { durationMs: s.durationMs } : {}),
      ...(s.detail ? { detail: s.detail } : {}),
    }));
    this.append(this.tlKey, "tool-timeline", {
      title: "Live agent run — tool calls",
      items,
    });
  }

  private emitStateMachine(): void {
    const active = this.activePhase();
    const states = [
      { id: "planning", label: "Planning" },
      { id: "investigating", label: "Investigating" },
      { id: "awaiting", label: "Awaiting approval", status: "waiting" },
      { id: "resolved", label: "Resolved", status: "success" },
    ];
    const transitions = [
      { id: "sm-t-0", from: "planning", to: "investigating" },
      { id: "sm-t-1", from: "investigating", to: "awaiting" },
      { id: "sm-t-2", from: "awaiting", to: "resolved" },
    ];
    this.append(this.smKey, "state-machine", {
      title: "Run state",
      states,
      transitions,
      active,
    });
  }

  private emitMemoryMap(): void {
    // One node per distinct tool/data source the agent pulled, + a Conclusion.
    const seen = new Set<string>();
    const sources: { id: string; label: string; type: string; strength?: number }[] = [];
    this.steps.forEach((s, i) => {
      if (seen.has(s.tool)) return;
      seen.add(s.tool);
      sources.push({
        id: `mem-${s.tool}`,
        label: toolLabel(s.tool),
        type: TOOL_SOURCE_TYPE[s.tool] ?? "source",
        // recency: later calls weigh slightly higher
        strength: Math.min(1, 0.5 + i * 0.1),
      });
    });
    const output = { id: "mem-output", label: "Conclusion", type: "output", strength: 1 };
    const nodes = [...sources, output];
    const links = sources.map((src, i) => ({
      id: `mem-l-${i}`,
      from: src.id,
      to: output.id,
      strength: src.strength ?? 0.6,
    }));
    this.append(this.mmKey, "memory-map", {
      title: "Context the agent used",
      nodes,
      links,
    });
  }

  /** Emit a node as ui.append the first time, ui.replace thereafter. */
  private append(key: string, type: string, props: Record<string, unknown>): void {
    if (this.appended.has(key)) {
      this.emit({ op: "ui.replace", key, props, replace: true });
    } else {
      this.appended.add(key);
      this.emit({ op: "ui.append", node: { key, type, props } });
    }
  }

  /** Force a ui.replace of the state machine with a given active phase. */
  setActive(active: string): void {
    this.append(this.smKey, "state-machine", {
      title: "Run state",
      states: [
        { id: "planning", label: "Planning" },
        { id: "investigating", label: "Investigating" },
        { id: "awaiting", label: "Awaiting approval", status: "waiting" },
        { id: "resolved", label: "Resolved", status: "success" },
      ],
      transitions: [
        { id: "sm-t-0", from: "planning", to: "investigating" },
        { id: "sm-t-1", from: "investigating", to: "awaiting" },
        { id: "sm-t-2", from: "awaiting", to: "resolved" },
      ],
      active,
    });
  }
}

/** Builds a one-line metrics/log summary for the rollback checkpoint. */
export function rollbackSummary(
  errorRatePct: number,
  p99Ms: number,
  topLogCount: number,
): string {
  return `error rate ${errorRatePct.toFixed(1)}% · p99 ${p99Ms}ms · top error ×${topLogCount} since the deploy`;
}
