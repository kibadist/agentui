import { Injectable, Logger } from "@nestjs/common";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool, type LanguageModel, type ToolSet } from "ai";
import { AgentSessionService } from "@kibadist/agentui-nest";
import type { ActionEvent, UIEvent } from "@kibadist/agentui-protocol";
import { AgentDB } from "../db/agent-db.js";
import { createIncidentTools } from "../db/agent-tools.js";
import { RunRecorder, rollbackSummary } from "./run-recorder.js";

/**
 * Live, instrumented SRE incident-investigation agent. On a user prompt we run a
 * single `generateText` call with the READ-only incident tools (+ a write
 * `propose_rollback`), and WRAP every tool's `execute` so each real call drives
 * a per-turn `RunRecorder`. The recorder streams the SVG observability
 * components (workflow-canvas, tool-timeline, state-machine, memory-map,
 * review-checkpoint, text-block) LIVE as the agent works.
 *
 * There is NO offline mock: without ANTHROPIC_API_KEY the example shows a clear
 * "set the key" message rather than fabricating a run.
 */

const SYSTEM_PROMPT = `You are an SRE on-call agent investigating a production incident.

You have READ-ONLY tools over the live fleet — call them to find the root cause, never invent values:
- list_services: fleet overview + health
- get_deploys({ service?, limit? }): recent deploys with a healthy flag
- query_error_logs({ service, sinceMinutes? }): recent error/warn logs
- get_metrics({ service }): error_rate / p99_ms / cpu series

Investigate the user's incident: find the affected service, identify the recent BAD deploy (healthy=0) that lines up with the error/metric spike, then call:
- propose_rollback({ service, toVersion, reason }): roll back to the last known-good version. Call this exactly ONCE, only after you've identified the bad deploy, then STOP.

The UI (a live observability dashboard) is rendered AUTOMATICALLY from your tool calls — do NOT describe components or UI. Just investigate and end with a short (1-3 sentence) plain-text conclusion naming the bad deploy and the recommended rollback.`;

interface TurnState {
  recorder: RunRecorder;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  readonly sessionService = new AgentSessionService();
  private readonly db = new AgentDB();
  private model: LanguageModel | null = null;

  /** Per-session turn counter + the latest turn's recorder, for decision/inspect. */
  private readonly turnCounters = new Map<string, number>();
  private readonly current = new Map<string, TurnState>();

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const anthropic = createAnthropic({ apiKey });
      this.model = anthropic("claude-sonnet-4-6");
      this.logger.log("Anthropic model initialized");
    } else {
      this.logger.warn(
        "ANTHROPIC_API_KEY not set — svg-api shows a real instrumented agent run and has no offline mock.",
      );
    }
    this.sessionService.startCleanup();
  }

  /** Welcome toast on a fresh session. */
  async handleSessionCreated(sessionId: string): Promise<void> {
    this.emit(sessionId, {
      op: "ui.toast",
      level: "info",
      message:
        "Connected. Ask the SRE agent to investigate an incident, e.g. \"checkout is throwing 500s\".",
    });
  }

  /** Route a user action to the right handler. */
  async handleAction(sessionId: string, action: ActionEvent): Promise<void> {
    if (action.name === "agent.inspect") {
      this.handleInspect(sessionId, action);
      return;
    }
    if (action.name === "agent.decision") {
      this.handleDecision(sessionId, action);
      return;
    }

    const userMessage =
      (action.payload?.["message"] as string | undefined) ??
      `Investigate: ${action.name}`;

    if (!this.model) {
      this.append(sessionId, "no-key", "text-block", {
        title: "No model configured",
        body:
          "Set ANTHROPIC_API_KEY in examples/svg-api/.env to run the agent — this example shows a real, instrumented agent run and has no offline mock.",
      });
      this.emit(sessionId, {
        op: "ui.toast",
        level: "warning",
        message: "ANTHROPIC_API_KEY not set — no agent run.",
      });
      return;
    }

    await this.runInvestigation(sessionId, userMessage);
  }

  /** Run one instrumented investigation turn. */
  private async runInvestigation(sessionId: string, userMessage: string): Promise<void> {
    const turn = (this.turnCounters.get(sessionId) ?? 0) + 1;
    this.turnCounters.set(sessionId, turn);

    const recorder = new RunRecorder(turn, (partial) => this.emit(sessionId, partial));
    this.current.set(sessionId, { recorder });

    // Emit the initial (empty) live components so the dashboard appears at once.
    recorder.emitLive();

    const tools = this.instrument(recorder, createIncidentTools(this.db));

    try {
      const result = await generateText({
        model: this.model!,
        system: SYSTEM_PROMPT,
        prompt: userMessage,
        tools,
        stopWhen: stepCountIs(8),
      });
      recorder.finish(result.text ?? "");
      if (!recorder.proposedRollback) {
        recorder.setActive("resolved");
      }
    } catch (err) {
      this.logger.error("Investigation error", err);
      this.emit(sessionId, {
        op: "ui.toast",
        level: "error",
        message: `Agent error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  /**
   * Wrap each incident tool's `execute` so the recorder observes the REAL tool
   * name, args, timing, result, and whether it threw. `propose_rollback` also
   * emits the review checkpoint (built from real metrics/logs).
   */
  private instrument(recorder: RunRecorder, tools: ToolSet): ToolSet {
    const wrapped: ToolSet = {};
    for (const [name, def] of Object.entries(tools)) {
      const original = def.execute;
      wrapped[name] = tool({
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (args: unknown, opts: unknown) => {
          const id = recorder.start(name, args);
          try {
            const result = await (original as (a: unknown, o: unknown) => unknown)(args, opts);
            recorder.end(id, { failed: false, result });
            if (name === "propose_rollback") {
              this.emitCheckpoint(recorder, args as Record<string, unknown>);
            }
            return result;
          } catch (err) {
            recorder.end(id, { failed: true, result: err });
            throw err;
          }
        },
      } as never) as ToolSet[string];
    }
    return wrapped;
  }

  /** Build the rollback checkpoint from the real metrics/logs for that service. */
  private emitCheckpoint(recorder: RunRecorder, args: Record<string, unknown>): void {
    const service = String(args["service"] ?? "");
    const toVersion = String(args["toVersion"] ?? "");
    const reason = String(args["reason"] ?? "Roll back to the last known-good version.");

    const series = this.db.metrics(service);
    const latest = series[series.length - 1];
    const logs = this.db.errorLogs(service);
    const topLog = logs.reduce((a, b) => (b.count > a.count ? b : a), logs[0]);
    const summary = latest
      ? rollbackSummary(latest.error_rate * 100, latest.p99_ms, topLog?.count ?? 0)
      : reason;

    recorder.checkpoint(service, toVersion, reason, summary);
  }

  /** A decision from the review checkpoint toggles the run state + a toast. */
  private handleDecision(sessionId: string, action: ActionEvent): void {
    const decision = (action.payload?.["action"] as string | undefined) ?? "unknown";
    const state = this.current.get(sessionId);

    let message: string;
    let level: "info" | "success" | "warning" | "error" = "success";
    let active = "awaiting";
    if (decision === "continue") {
      message = "Rollback executed — service recovering";
      active = "resolved";
    } else if (decision === "stop") {
      message = "Rollback held";
      level = "warning";
      active = "awaiting";
    } else if (decision === "revise") {
      message = "Revision requested";
      level = "info";
      active = "awaiting";
    } else {
      message = `Recorded decision: ${decision}`;
    }

    this.emit(sessionId, { op: "ui.toast", level, message });
    if (state) state.recorder.setActive(active);
  }

  /** Inspecting a workflow node / timeline item renders that step's detail. */
  private handleInspect(sessionId: string, action: ActionEvent): void {
    const kind = (action.payload?.["kind"] as string | undefined) ?? "step";
    const id = action.payload?.["id"] as string | undefined;
    const state = this.current.get(sessionId);
    const detail = id && state ? state.recorder.stepDetail(id) : null;
    this.append(sessionId, `insp-${id ?? "x"}-${Date.now()}`, "text-block", {
      title: "Inspect",
      body:
        detail ?? `No detail available for ${kind} "${id ?? "unknown"}".`,
    });
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
}
