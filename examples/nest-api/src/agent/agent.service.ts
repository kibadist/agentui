import { Injectable, Logger } from "@nestjs/common";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { AgentSessionService } from "@kibadist/agentui-nest";
import { runAgentLoop } from "@kibadist/agentui-ai";
import { describeComponents, type ComponentDef } from "@kibadist/agentui-validate";
import type { ActionEvent } from "@kibadist/agentui-protocol";

/** Component schemas — single source of truth for allowed types + props */
const COMPONENT_DEFS: Record<string, ComponentDef> = {
  "text-block": {
    propsSchema: z.object({
      title: z.string().optional().describe("heading text"),
      body: z.string().describe("markdown or plain text content"),
    }),
  },
  "info-card": {
    propsSchema: z.object({
      title: z.string().describe("card heading"),
      description: z.string().describe("card body text"),
      icon: z.string().optional().describe("emoji icon"),
    }),
  },
  "action-card": {
    propsSchema: z.object({
      title: z.string().describe("card heading"),
      description: z.string().describe("body text"),
      actions: z
        .array(z.object({ name: z.string(), label: z.string() }))
        .describe("buttons the user can click"),
    }),
  },
  "data-table": {
    propsSchema: z.object({
      title: z.string().optional().describe("table heading"),
      columns: z.array(z.string()).describe("column headers"),
      rows: z.array(z.array(z.string())).describe("row data"),
    }),
  },
  "status-badge": {
    propsSchema: z.object({
      label: z.string().describe("badge text"),
      variant: z
        .enum(["info", "success", "warning", "error"])
        .describe("color/style"),
    }),
  },
};

const ALLOWED_TYPES = Object.keys(COMPONENT_DEFS);

const SYSTEM_PROMPT = `You are a helpful assistant that renders UI components for the user.

You MUST use the emit_ui_event tool to show information on screen.
Each component you emit needs a unique "key" string.

Available component types and their props:

${describeComponents(COMPONENT_DEFS)}

You can also use:
- op "ui.toast" to show ephemeral notifications
- op "ui.replace" to update an existing component by key
- op "ui.remove" to remove a component by key

Always respond with UI components. Be concise.`;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  readonly sessionService = new AgentSessionService();
  private model: LanguageModel | null = null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const anthropic = createAnthropic({ apiKey });
      this.model = anthropic("claude-sonnet-4-20250514");
      this.logger.log("Anthropic model initialized");
    } else {
      this.logger.warn(
        "ANTHROPIC_API_KEY not set – agent will return mock UI events",
      );
    }
    this.sessionService.startCleanup();
  }

  /** Kick off the agent loop for a brand-new session */
  async handleSessionCreated(sessionId: string): Promise<void> {
    // Emit a welcome toast
    this.sessionService.emitUI(sessionId, {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      op: "ui.toast",
      level: "info",
      message: "Session started. Send a message to begin.",
    });
  }

  /** Run the agent when a user action comes in */
  async handleAction(sessionId: string, action: ActionEvent): Promise<void> {
    const userMessage =
      action.payload?.["message"] as string | undefined ??
      `User performed action: ${action.name}`;

    if (!this.model) {
      this.emitMockResponse(sessionId, userMessage);
      return;
    }

    try {
      await runAgentLoop({
        model: this.model,
        system: SYSTEM_PROMPT,
        prompt: userMessage,
        allowedTypes: [...ALLOWED_TYPES],
        sessionId,
        onUIEvent: (event) => {
          this.sessionService.emitUI(sessionId, event);
        },
      });
    } catch (err) {
      this.logger.error("Agent loop error", err);
      this.sessionService.emitUI(sessionId, {
        v: 1,
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        sessionId,
        op: "ui.toast",
        level: "error",
        message: `Agent error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  /** Fallback when no API key is set – demonstrates the protocol without LLM */
  private emitMockResponse(sessionId: string, userMessage: string): void {
    this.sessionService.emitUI(sessionId, {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      op: "ui.append",
      node: {
        key: `resp-${Date.now()}`,
        type: "text-block",
        props: {
          title: "Echo Response",
          body: `You said: "${userMessage}"\n\n_(No ANTHROPIC_API_KEY set – this is a mock response.)_`,
        },
      },
    });

    this.sessionService.emitUI(sessionId, {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      op: "ui.append",
      node: {
        key: `sample-table-${Date.now()}`,
        type: "data-table",
        props: {
          title: "Sample Data",
          columns: ["Name", "Status", "Score"],
          rows: [
            ["Alice", "Active", "95"],
            ["Bob", "Pending", "82"],
            ["Carol", "Active", "91"],
          ],
        },
      },
    });
  }
}
