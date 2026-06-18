// ─── Shared types for AgentUI SVG components ─────────────────────────────────
//
// Pure data shapes. Every component accepts a declarative data object through a
// `.data` property (or a `data` attribute holding the same shape as JSON).
// These types are the public contract — keep them framework-agnostic.

/**
 * Canonical status vocabulary shared across components. Not every component
 * uses every value; each documents the subset it renders.
 */
export type AgentStatus =
  | "idle"
  | "planning"
  | "running"
  | "waiting"
  | "success"
  | "failed"
  | "skipped"
  | "blocked";

/** Severity / emphasis level used by checkpoints and relevance styling. */
export type AgentLevel = "low" | "medium" | "high";

// ─── Workflow Canvas (agentui-workflow-canvas) ───────────────────────────────

export interface WorkflowNode {
  /** Stable identity used for selection + diffing. */
  id: string;
  /** Short human label. */
  label: string;
  /** Optional secondary line (e.g. tool name, role). */
  sublabel?: string;
  /** Visual status style. */
  status?: AgentStatus;
  /** Explicit position in canvas user-units. Auto-laid-out when omitted. */
  x?: number;
  y?: number;
  /** Optional free-form payload surfaced in selection events. */
  meta?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** Optional edge label. */
  label?: string;
  /** Visual status style. */
  status?: AgentStatus;
}

export interface WorkflowData {
  nodes: WorkflowNode[];
  edges?: WorkflowEdge[];
}

// ─── Tool Call Timeline (agentui-tool-timeline) ──────────────────────────────

export interface TimelineItem {
  id: string;
  label: string;
  /** running | success | failed | skipped | blocked. */
  status?: AgentStatus;
  /** Duration in milliseconds, shown as a chip when present. */
  durationMs?: number;
  /** Optional detail markdown/plain text surfaced on selection. */
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface TimelineData {
  items: TimelineItem[];
}

// ─── Review Checkpoint (agentui-review-checkpoint) ───────────────────────────

export type ReviewAction = "continue" | "stop" | "revise";

export interface CheckpointData {
  title: string;
  description?: string;
  /** Emphasis: low | medium | high. */
  level?: AgentLevel;
  /** One-line summary of what is being approved. */
  summary?: string;
  /** Restrict the offered actions; defaults to all three. */
  actions?: ReviewAction[];
}

// ─── Memory Map (agentui-memory-map) ─────────────────────────────────────────

export type MemoryNodeType =
  | "preference"
  | "project"
  | "source"
  | "rule"
  | "output";

export interface MemoryNode {
  id: string;
  label: string;
  type: MemoryNodeType;
  /** Optional cluster/group key for clustered layout. */
  group?: string;
  x?: number;
  y?: number;
  meta?: Record<string, unknown>;
}

export interface MemoryLink {
  id: string;
  from: string;
  to: string;
  /** Relevance / strength in [0, 1]; drives stroke weight + opacity. */
  strength?: number;
}

export interface MemoryData {
  nodes: MemoryNode[];
  links?: MemoryLink[];
}

// ─── State Machine Viewer (agentui-state-machine) ────────────────────────────

export interface MachineState {
  id: string;
  label: string;
  /** Visual status style. The active state is marked separately. */
  status?: AgentStatus;
  meta?: Record<string, unknown>;
}

export interface MachineTransition {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface MachineData {
  states: MachineState[];
  transitions?: MachineTransition[];
  /** Id of the currently active state. */
  active?: string;
}
