// Barrel for the shared foundation (base class, events, a11y, dom, scene).
export { AgentUIElement } from "./element.js";
export { defineElement } from "./define.js";
export {
  AGENTUI_EVENT,
  makeEvent,
  type AgentUIEventName,
  type AgentUITargetKind,
  type AgentUIEventMap,
  type SelectDetail,
  type ActionDetail,
  type DecisionDetail,
  type EditDetail,
  type RemoveDetail,
} from "./events.js";
export {
  makeInteractive,
  isActivationKey,
  closestActivatable,
  type InteractiveOptions,
} from "./a11y.js";
export { svg, html, setAttrs, clear, truncate, bezierPath, linePath } from "./dom.js";
export { createScene, type SvgScene, type SceneOptions } from "./scene.js";
