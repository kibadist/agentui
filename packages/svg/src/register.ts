// ─── Custom element registration ─────────────────────────────────────────────
//
// Importing this module for its side effect registers every component as a
// custom element:
//
//   import "@kibadist/agentui-svg/register";
//
// Or call `registerAll()` explicitly (e.g. after a feature check). Registration
// is idempotent — safe to import/call more than once.

import { defineElement } from "./base/define.js";
import { WorkflowCanvas } from "./components/workflow-canvas.js";
import { ToolTimeline } from "./components/tool-timeline.js";
import { ReviewCheckpoint } from "./components/review-checkpoint.js";
import { MemoryMap } from "./components/memory-map.js";
import { StateMachine } from "./components/state-machine.js";

/** Tag name → component class. The public custom-element contract. */
export const TAG_NAMES = {
  "agentui-workflow-canvas": WorkflowCanvas,
  "agentui-tool-timeline": ToolTimeline,
  "agentui-review-checkpoint": ReviewCheckpoint,
  "agentui-memory-map": MemoryMap,
  "agentui-state-machine": StateMachine,
} as const;

/** Register all AgentUI SVG components. Idempotent. */
export function registerAll(): void {
  for (const [tag, ctor] of Object.entries(TAG_NAMES)) {
    defineElement(tag, ctor);
  }
}

// Side effect: register on import.
registerAll();

// Augment the JSX/DOM element maps so TS knows the tags + their event types.
declare global {
  interface HTMLElementTagNameMap {
    "agentui-workflow-canvas": WorkflowCanvas;
    "agentui-tool-timeline": ToolTimeline;
    "agentui-review-checkpoint": ReviewCheckpoint;
    "agentui-memory-map": MemoryMap;
    "agentui-state-machine": StateMachine;
  }
}
