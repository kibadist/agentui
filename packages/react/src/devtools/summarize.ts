import type { AgentAction } from "../reducer.js";

/** Coarse category for filter checkboxes in the event log. */
export type Category = "ui" | "tool" | "reasoning" | "optimistic" | "session" | "other";

export function categoryOf(action: AgentAction): Category {
  switch (action.op) {
    case "ui.append":
    case "ui.replace":
    case "ui.remove":
    case "ui.toast":
    case "ui.navigate":
    case "ui.reset":
      return "ui";
    case "tool.start":
    case "tool.args-delta":
    case "tool.result":
    case "tool.cancel":
      return "tool";
    case "reasoning.start":
    case "reasoning.delta":
    case "reasoning.end":
      return "reasoning";
    case "optimistic.apply":
    case "optimistic.confirm":
    case "optimistic.rollback":
      return "optimistic";
    case "session.meta":
      return "session";
    default:
      return "other";
  }
}

/** One-line summary string for an action, used as the event-log row body. */
export function summarize(action: AgentAction): string {
  switch (action.op) {
    case "ui.append":
      return `key=${action.node.key} type=${action.node.type}`;
    case "ui.replace":
      return `key=${action.key} ${"patch" in action ? "(patch)" : action.replace ? "(replace)" : "(merge)"}`;
    case "ui.remove":
      return `key=${action.key}`;
    case "ui.toast":
      return `${action.level}: ${truncate(action.message, 60)}`;
    case "ui.navigate":
      return `${action.replace ? "replace" : "push"} ${action.href}`;
    case "ui.reset":
      return "(server reset)";
    case "tool.start":
      return `id=${action.id} ${action.name}`;
    case "tool.args-delta":
      return `id=${action.id} +${action.delta.length}c`;
    case "tool.result":
      return `id=${action.id} ${action.status}${
        action.durationMs !== undefined ? ` ${action.durationMs}ms` : ""
      }`;
    case "tool.cancel":
      return `id=${action.id}`;
    case "reasoning.start":
      return `id=${action.id}`;
    case "reasoning.delta":
      return `id=${action.id} +${action.delta.length}c`;
    case "reasoning.end":
      return `id=${action.id}${
        action.tokens !== undefined ? ` ${action.tokens}tok` : ""
      }`;
    case "optimistic.apply":
      return `entity=${action.entityKey} origin=${action.originId}`;
    case "optimistic.confirm":
    case "optimistic.rollback":
      return `origin=${action.originId}`;
    case "session.meta":
      return `conv=${action.conversationId}`;
    case "__reset__":
      return "(client reset)";
    default:
      return "";
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
