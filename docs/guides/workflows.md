# Workflows / steppers

Multi-step wizards (onboarding, troubleshooting, multi-page forms) are first-class. The server emits a workflow lifecycle; the client subscribes by id and renders any UI.

````ts
// server
await stream.emit({
  op: "workflow.start",
  id: "onboard",
  steps: [
    { id: "profile",   title: "Your profile" },
    { id: "preferences", title: "Preferences" },
    { id: "confirm",   title: "Review" },
  ],
});

// ...later...
await stream.emit({ op: "workflow.advance", id: "onboard", stepId: "preferences" });
await stream.emit({ op: "workflow.complete", id: "onboard", result: { ok: true } });
````

````tsx
// client
import { WorkflowStepper, useWorkflow } from "@kibadist/agentui-react";

function Onboarding() {
  return (
    <WorkflowStepper
      workflowId="onboard"
      render={(wf) => (
        <ol>
          {wf.steps.map((s) => (
            <li key={s.id} data-status={s.status}>{s.title}</li>
          ))}
        </ol>
      )}
    />
  );
}

// Or use the hook directly:
function Header() {
  const { workflow, currentStep, isDone } = useWorkflow("onboard");
  if (!workflow) return null;
  return <h2>{isDone ? "Done" : currentStep?.title}</h2>;
}
````

`workflow.cancel` with optional `reason` terminates without a result. After `complete` or `cancel`, subsequent `advance`/`complete`/`cancel` events for the same workflow id are silently dropped.

## Related

- [Tool calls](./tool-calls.md)
