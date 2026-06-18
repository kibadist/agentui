// ─── @kibadist/agentui-svg ───────────────────────────────────────────────────
//
// SVG-native Web Components for visualizing agent behavior. Importing this entry
// gives you the component classes, the shared foundation, and all data types,
// but does NOT register the custom elements. To register them as custom
// elements (so `<agentui-workflow-canvas>` works in HTML), import the side-
// effecting entry once near your app root:
//
//   import "@kibadist/agentui-svg/register";
//
// or call `registerAll()` from this module yourself.

// Foundation
export * from "./base/index.js";
export * from "./styles/index.js";

// Data model
export * from "./types.js";

// Components (classes — registration is separate, see ./register.js)
export { WorkflowCanvas } from "./components/workflow-canvas.js";
export { ToolTimeline } from "./components/tool-timeline.js";
export { ReviewCheckpoint } from "./components/review-checkpoint.js";
export { MemoryMap } from "./components/memory-map.js";
export { StateMachine } from "./components/state-machine.js";

export { registerAll, TAG_NAMES } from "./register.js";
