import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { AgentDB } from "./agent-db.js";

/**
 * Read-only incident-investigation tools over the deploy database, plus one
 * WRITE action (`propose_rollback`) that does NOT mutate the DB — it returns a
 * sentinel string the service layer turns into a review checkpoint.
 *
 * The agent calls these to investigate live; the service WRAPS each tool's
 * `execute` (see `createInstrumentedTools`) so it can record real tool names,
 * args, durations, and results and stream the SVG observability components.
 */
export function createIncidentTools(db: AgentDB): ToolSet {
  return {
    list_services: tool({
      description:
        "List every production service with its current health status and owning team. Use for a fleet overview.",
      inputSchema: z.object({}),
      execute: async () => db.listServices(),
    }),

    get_deploys: tool({
      description:
        "Recent deploys (newest first) with their health flag. Optionally filter to one service. Use to find a recent bad deploy.",
      inputSchema: z.object({
        service: z.string().optional().describe('e.g. "checkout-service"'),
        limit: z.number().int().positive().optional().describe("default 10"),
      }),
      execute: async ({ service, limit }) => db.recentDeploys(service, limit ?? 10),
    }),

    query_error_logs: tool({
      description:
        "Recent error/warn logs for a service (newest first). `sinceMinutes` limits to the last N minutes.",
      inputSchema: z.object({
        service: z.string().describe('e.g. "checkout-service"'),
        sinceMinutes: z.number().int().positive().optional().describe("look back this many minutes"),
      }),
      execute: async ({ service, sinceMinutes }) => {
        const since =
          sinceMinutes != null
            ? new Date(Date.now() - sinceMinutes * 60_000).toISOString()
            : undefined;
        return db.errorLogs(service, since);
      },
    }),

    get_metrics: tool({
      description:
        "Metric series for a service: error_rate, p99 latency (ms), and cpu over the recent window. Use to confirm impact.",
      inputSchema: z.object({
        service: z.string().describe('e.g. "checkout-service"'),
      }),
      execute: async ({ service }) => db.metrics(service),
    }),

    propose_rollback: tool({
      description:
        "Propose rolling a service back to a known-good version. Call ONLY once you have identified the bad deploy. This requires human approval and ends the investigation — do not call more tools after it.",
      inputSchema: z.object({
        service: z.string().describe('e.g. "checkout-service"'),
        toVersion: z.string().describe('known-good version, e.g. "v2.4.0"'),
        reason: z.string().describe("one-line justification for the rollback"),
      }),
      execute: async ({ service, toVersion }) =>
        `Rollback proposed for ${service} to ${toVersion}; awaiting human approval — stop and do not call more tools.`,
    }),
  };
}
