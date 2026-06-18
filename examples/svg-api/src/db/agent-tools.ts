import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { AgentDB } from "./agent-db.js";

/**
 * Read-only AI SDK tools over the agent-runs database. The agent calls these to
 * fetch a recorded run, then renders it with `emit_ui_event`. Passed to
 * `runAgentLoop` as `extraTools`.
 */
export function createAgentTools(db: AgentDB): ToolSet {
  return {
    list_runs: tool({
      description:
        "List every recorded agent run (slug, task, status). Use to pick a run to visualize.",
      inputSchema: z.object({}),
      execute: async () => db.listRuns(),
    }),

    get_run: tool({
      description:
        "Get one recorded run by slug: its workflow graph, tool timeline, state machine, memory map, and optional review checkpoint.",
      inputSchema: z.object({
        slug: z.string().describe('Run slug, e.g. "deploy-investigation"'),
      }),
      execute: async ({ slug }) => db.getRun(slug) ?? { error: `No run with slug ${slug}` },
    }),
  };
}
