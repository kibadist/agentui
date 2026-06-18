import { createRegistry } from "@kibadist/agentui-react";
import {
  WorkflowCanvasView,
  ToolTimelineView,
  StateMachineView,
  MemoryMapView,
  ReviewCheckpointView,
  TextBlock,
} from "./views";
import {
  workflowCanvasSchema,
  toolTimelineSchema,
  stateMachineSchema,
  memoryMapSchema,
  reviewCheckpointSchema,
  textBlockSchema,
} from "./schemas";

export const registry = createRegistry({
  "workflow-canvas": { component: WorkflowCanvasView, propsSchema: workflowCanvasSchema },
  "tool-timeline": { component: ToolTimelineView, propsSchema: toolTimelineSchema },
  "state-machine": { component: StateMachineView, propsSchema: stateMachineSchema },
  "memory-map": { component: MemoryMapView, propsSchema: memoryMapSchema },
  "review-checkpoint": { component: ReviewCheckpointView, propsSchema: reviewCheckpointSchema },
  "text-block": { component: TextBlock, propsSchema: textBlockSchema },
});
