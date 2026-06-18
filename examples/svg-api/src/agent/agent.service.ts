import { Injectable, Logger } from "@nestjs/common";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { AgentSessionService } from "@kibadist/agentui-nest";
import { runAgentLoop } from "@kibadist/agentui-ai";
import { describeComponents, type ComponentDef } from "@kibadist/agentui-validate";
import type { ActionEvent, UIEvent } from "@kibadist/agentui-protocol";
import { AgentDB, type RunDetail } from "../db/agent-db.js";
import { createAgentTools } from "../db/agent-tools.js";

/**
 * Agent-observability component schemas — the allowed UI vocabulary. Mirrors the
 * frontend SVG registry; keep the two in sync. `describeComponents` turns these
 * into the system prompt's component catalog.
 */
const COMPONENT_DEFS: Record<string, ComponentDef> = {
  "workflow-canvas": {
    propsSchema: z.object({
      title: z.string().optional(),
      nodes: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            sublabel: z.string().optional(),
            status: z.string().optional(),
          }),
        )
        .describe("workflow steps, drawn as a node graph"),
      edges: z
        .array(
          z.object({
            id: z.string(),
            from: z.string(),
            to: z.string(),
            label: z.string().optional(),
            status: z.string().optional(),
          }),
        )
        .optional()
        .describe("directed edges between node ids; include branch/merge edges"),
    }),
  },
  "tool-timeline": {
    propsSchema: z.object({
      title: z.string().optional(),
      items: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            status: z.string().optional(),
            durationMs: z.number().optional(),
            detail: z.string().optional(),
          }),
        )
        .describe("time-ordered tool calls / steps"),
    }),
  },
  "state-machine": {
    propsSchema: z.object({
      title: z.string().optional(),
      states: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          status: z.string().optional(),
        }),
      ),
      transitions: z
        .array(
          z.object({
            id: z.string(),
            from: z.string(),
            to: z.string(),
            label: z.string().optional(),
          }),
        )
        .optional(),
      active: z.string().optional().describe("id of the currently active state"),
    }),
  },
  "memory-map": {
    propsSchema: z.object({
      title: z.string().optional(),
      nodes: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          type: z.string().describe("preference | project | source | rule | output"),
          strength: z.number().optional(),
        }),
      ),
      links: z
        .array(
          z.object({
            id: z.string(),
            from: z.string(),
            to: z.string(),
            strength: z.number().optional(),
          }),
        )
        .optional(),
    }),
  },
  "review-checkpoint": {
    propsSchema: z.object({
      title: z.string(),
      description: z.string().optional(),
      level: z.string().optional().describe("low | medium | high"),
      summary: z.string().optional(),
    }),
  },
  "text-block": {
    propsSchema: z.object({
      title: z.string().optional().describe("heading"),
      body: z.string().describe("markdown or plain text — good for summaries"),
    }),
  },
};

const ALLOWED_TYPES = Object.keys(COMPONENT_DEFS);

const SYSTEM_PROMPT = `You are an agent run visualizer. You turn recorded agent runs into a live observability dashboard built from typed SVG components.

You have READ-ONLY database tools — call them to fetch real run data, never invent runs or values:
- list_runs: every recorded run (slug, task, status)
- get_run(slug): one run's full data — workflow graph, tool timeline, state machine, memory map, and an optional review checkpoint

Workflow: call list_runs and/or get_run, then RENDER the run with the emit_ui_event tool. For the chosen run, emit:
- a "workflow-canvas" from run.workflow (nodes + edges)
- a "tool-timeline" from run.timeline (items)
- a "state-machine" from run.machine (states + transitions + active)
- a "memory-map" from run.memory (nodes + links)
- a "review-checkpoint" ONLY if the run has a checkpoint
- a short "text-block" summary at the end

Each component needs a unique "key". Pass the run's data straight into the matching component props and always include a "title". Be concise; always respond with UI components, not just text.

Component types and props:

${describeComponents(COMPONENT_DEFS)}`;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  readonly sessionService = new AgentSessionService();
  private readonly db = new AgentDB();
  private model: LanguageModel | null = null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const anthropic = createAnthropic({ apiKey });
      this.model = anthropic("claude-sonnet-4-6");
      this.logger.log("Anthropic model initialized");
    } else {
      this.logger.warn(
        "ANTHROPIC_API_KEY not set – using DB-backed mock responses",
      );
    }
    this.sessionService.startCleanup();
  }

  /** Welcome toast on a fresh session. */
  async handleSessionCreated(sessionId: string): Promise<void> {
    this.emit(sessionId, {
      op: "ui.toast",
      level: "info",
      message: "Connected. Ask to visualize a run: deploy, intake, or competitor research.",
    });
  }

  /** Run the agent (or mock) when a user action arrives. */
  async handleAction(sessionId: string, action: ActionEvent): Promise<void> {
    // Inspecting a workflow node / timeline item / memory node renders its detail.
    if (action.name === "agent.inspect") {
      const kind = action.payload?.["kind"] as string | undefined;
      const id = action.payload?.["id"] as string | undefined;
      const slug = action.payload?.["slug"] as string | undefined;
      const detail =
        slug && id
          ? kind === "memory"
            ? this.db.memoryDetail(slug, id)
            : this.db.stepDetail(slug, id)
          : null;
      this.append(sessionId, `inspect-${id ?? "x"}-${Date.now()}`, "text-block", {
        title: "Inspect",
        body: detail ?? `No detail available for ${kind ?? "item"} "${id ?? "unknown"}".`,
      });
      return;
    }

    // A decision from a review checkpoint is acknowledged with a toast.
    if (action.name === "agent.decision") {
      const decision = (action.payload?.["action"] as string | undefined) ?? "unknown";
      this.emit(sessionId, {
        op: "ui.toast",
        level: "success",
        message: `Recorded decision: ${decision}`,
      });
      return;
    }

    const userMessage =
      (action.payload?.["message"] as string | undefined) ??
      `User performed action: ${action.name}`;

    if (!this.model) {
      this.mockResponse(sessionId, userMessage);
      return;
    }

    try {
      await runAgentLoop({
        model: this.model,
        system: SYSTEM_PROMPT,
        prompt: userMessage,
        allowedTypes: [...ALLOWED_TYPES],
        sessionId,
        extraTools: createAgentTools(this.db),
        onUIEvent: (event) => this.sessionService.emitUI(sessionId, event),
      });
    } catch (err) {
      this.logger.error("Agent loop error", err);
      this.emit(sessionId, {
        op: "ui.toast",
        level: "error",
        message: `Agent error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  /** Build + emit a UIEvent, filling in the envelope fields. */
  private emit(sessionId: string, partial: Record<string, unknown>): void {
    this.sessionService.emitUI(sessionId, {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      ...partial,
    } as UIEvent);
  }

  private append(sessionId: string, key: string, type: string, props: unknown): void {
    this.emit(sessionId, { op: "ui.append", node: { key, type, props } });
  }

  // ---- DB-backed mock backend (no API key) -------------------------------
  // Keyword-routes the user's message to a recorded run and emits every
  // matching observability component, so the example is fully usable offline.

  private mockResponse(sessionId: string, message: string): void {
    const text = message.toLowerCase();
    let slug = "deploy-investigation";
    if (text.includes("intake") || text.includes("patient")) {
      slug = "intake-summary";
    } else if (
      text.includes("competitor") ||
      text.includes("research") ||
      text.includes("pricing")
    ) {
      slug = "competitor-research";
    } else if (text.includes("deploy")) {
      slug = "deploy-investigation";
    }

    const run = this.db.getRun(slug);
    if (!run) {
      this.emit(sessionId, { op: "ui.toast", level: "warning", message: `No run "${slug}".` });
      return;
    }
    this.renderRun(sessionId, run);
  }

  /** Emit the full set of observability components for one run. */
  private renderRun(sessionId: string, run: RunDetail): void {
    const stamp = Date.now();

    this.append(sessionId, `wf-${run.slug}-${stamp}`, "workflow-canvas", {
      title: `${run.task} — workflow`,
      nodes: run.workflow.nodes,
      edges: run.workflow.edges,
    });

    this.append(sessionId, `tl-${run.slug}-${stamp}`, "tool-timeline", {
      title: `${run.task} — timeline`,
      items: run.timeline.items,
    });

    this.append(sessionId, `sm-${run.slug}-${stamp}`, "state-machine", {
      title: `${run.task} — state`,
      states: run.machine.states,
      transitions: run.machine.transitions,
      ...(run.machine.active ? { active: run.machine.active } : {}),
    });

    this.append(sessionId, `mm-${run.slug}-${stamp}`, "memory-map", {
      title: `${run.task} — memory`,
      nodes: run.memory.nodes,
      links: run.memory.links,
    });

    if (run.checkpoint) {
      this.append(sessionId, `cp-${run.slug}-${stamp}`, "review-checkpoint", {
        title: run.checkpoint.title,
        ...(run.checkpoint.description ? { description: run.checkpoint.description } : {}),
        ...(run.checkpoint.level ? { level: run.checkpoint.level } : {}),
        ...(run.checkpoint.summary ? { summary: run.checkpoint.summary } : {}),
      });
    }

    this.append(sessionId, `tx-${run.slug}-${stamp}`, "text-block", {
      title: run.task,
      body: `Run **${run.slug}** is currently *${run.status}*. ${run.workflow.nodes.length} workflow steps, ${run.machine.states.length} states, ${run.memory.nodes.length} memory items.`,
    });
  }
}
