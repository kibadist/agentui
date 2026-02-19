import type OpenAI from "openai";
import type { UIEvent } from "@agentui/protocol";
import { safeParseUIEvent } from "@agentui/validate";
import { createUIEmitterTool, UI_EMITTER_TOOL_NAME } from "./tool.js";

export interface RunAgentLoopOptions {
  openai: OpenAI;
  model?: string;
  /** System message (instructions for the agent) */
  systemPrompt: string;
  /** Current user message / action description */
  userMessage: string;
  /** Allowed component types from your registry */
  allowedTypes: string[];
  /** Session id injected into emitted events */
  sessionId: string;
  /** Called for each valid UI event produced by the model */
  onUIEvent: (event: UIEvent) => void;
  /** Optional: additional tools beyond the UI emitter */
  extraTools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  /** Optional: handler for extra tool calls */
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>;
  /** Max tool-call rounds to prevent infinite loops (default 10) */
  maxRounds?: number;
}

/**
 * Runs a multi-turn agent loop that calls OpenAI and streams
 * UI events via the emit_ui_event tool.
 *
 * Returns the final assistant message content (if any).
 */
export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<string | null> {
  const {
    openai,
    model = "gpt-4o",
    systemPrompt,
    userMessage,
    allowedTypes,
    sessionId,
    onUIEvent,
    extraTools = [],
    onToolCall,
    maxRounds = 10,
  } = opts;

  const uiTool = createUIEmitterTool(allowedTypes);
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [uiTool, ...extraTools];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  for (let round = 0; round < maxRounds; round++) {
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools,
    });

    const choice = response.choices[0];
    if (!choice) break;

    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    // No tool calls → done
    if (!assistantMsg.tool_calls?.length) {
      return assistantMsg.content ?? null;
    }

    // Process tool calls
    for (const tc of assistantMsg.tool_calls) {
      let result: string;

      if (tc.function.name === UI_EMITTER_TOOL_NAME) {
        const args = JSON.parse(tc.function.arguments);

        // Hydrate into a full UIEvent
        const event = {
          ...args,
          v: 1,
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          sessionId,
        };

        const parsed = safeParseUIEvent(event);
        if (parsed.ok) {
          onUIEvent(parsed.value);
          result = JSON.stringify({ ok: true, eventId: event.id });
        } else {
          result = JSON.stringify({ ok: false, error: parsed.error.message });
        }
      } else if (onToolCall) {
        const args = JSON.parse(tc.function.arguments);
        result = await onToolCall(tc.function.name, args);
      } else {
        result = JSON.stringify({ error: `Unknown tool: ${tc.function.name}` });
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }

    // If the model signaled stop, we're done
    if (choice.finish_reason === "stop") {
      return assistantMsg.content ?? null;
    }
  }

  return null;
}
