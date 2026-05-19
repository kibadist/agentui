import { useMemo } from "react";
import { useAgentSelector } from "./selectors.js";
import type { Workflow, WorkflowStep } from "./reducer.js";

export interface UseWorkflowResult {
  workflow: Workflow | undefined;
  /** Convenience: the current step. */
  currentStep: WorkflowStep | undefined;
  /** Convenience: true when status === "active". */
  isActive: boolean;
  /** Convenience: true when status is "completed" or "cancelled". */
  isDone: boolean;
}

const EMPTY: UseWorkflowResult = Object.freeze({
  workflow: undefined,
  currentStep: undefined,
  isActive: false,
  isDone: false,
});

/**
 * Subscribe to a single workflow by id. Returns the workflow plus convenience
 * accessors. Result is referentially stable when the underlying workflow
 * reference doesn't change.
 */
export function useWorkflow(workflowId: string): UseWorkflowResult {
  const workflow = useAgentSelector((s) => s.workflows.get(workflowId));
  return useMemo<UseWorkflowResult>(() => {
    if (!workflow) return EMPTY;
    return {
      workflow,
      currentStep: workflow.steps.find((s) => s.id === workflow.currentStepId),
      isActive: workflow.status === "active",
      isDone: workflow.status === "completed" || workflow.status === "cancelled",
    };
  }, [workflow]);
}
