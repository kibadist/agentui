"use client";

import type { ReactNode } from "react";
import { useWorkflow } from "./use-workflow.js";
import type { Workflow } from "./reducer.js";

export interface WorkflowStepperProps {
  workflowId: string;
  /** Render-prop. Receives the live Workflow. */
  render: (workflow: Workflow) => ReactNode;
  /** Optional: render when no workflow exists for `workflowId`. Default null. */
  fallback?: () => ReactNode;
}

/**
 * Render-prop component that subscribes to a workflow by id and delegates UI
 * to the caller. Pure presentational; emits no DOM beyond what `render` returns.
 */
export function WorkflowStepper(props: WorkflowStepperProps): ReactNode {
  const { workflow } = useWorkflow(props.workflowId);
  if (!workflow) {
    return props.fallback ? props.fallback() : null;
  }
  return props.render(workflow);
}
