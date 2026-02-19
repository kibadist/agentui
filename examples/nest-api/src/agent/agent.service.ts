import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { AgentSessionService } from "@agentui/nest";
import { runAgentLoop } from "@agentui/openai";
import type { ActionEvent } from "@agentui/protocol";

/** Component types the agent is allowed to emit */
const ALLOWED_TYPES = [
  "text-block",
  "info-card",
  "action-card",
  "data-table",
  "status-badge",
] as const;

const SYSTEM_PROMPT = `You are a helpful assistant that renders UI components for the user.

You MUST use the emit_ui_event tool to show information on screen.
Each component you emit needs a unique "key" string.

Available component types and their props:

1. "text-block"
   - title (string, optional): heading text
   - body (string): markdown or plain text content

2. "info-card"
   - title (string): card heading
   - description (string): card body text
   - icon (string, optional): emoji icon

3. "action-card"
   - title (string): card heading
   - description (string): body text
   - actions (array of { name: string, label: string }): buttons the user can click

4. "data-table"
   - title (string, optional): table heading
   - columns (array of string): column headers
   - rows (array of array of string): row data

5. "status-badge"
   - label (string): badge text
   - variant ("info" | "success" | "warning" | "error"): color/style

You can also use:
- op "ui.toast" to show ephemeral notifications
- op "ui.replace" to update an existing component by key
- op "ui.remove" to remove a component by key

Always respond with UI components. Be concise.`;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  readonly sessionService = new AgentSessionService();
  private openai: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({
        apiKey,
        baseURL: "https://api.deepseek.com",
      });
      this.logger.log("DeepSeek client initialized");
    } else {
      this.logger.warn(
        "DEEPSEEK_API_KEY not set – agent will return mock UI events",
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

    if (!this.openai) {
      this.emitMockResponse(sessionId, userMessage);
      return;
    }

    try {
      await runAgentLoop({
        openai: this.openai,
        model: "deepseek-chat",
        systemPrompt: SYSTEM_PROMPT,
        userMessage,
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
          body: `You said: "${userMessage}"\n\n_(No DEEPSEEK_API_KEY set – this is a mock response.)_`,
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
