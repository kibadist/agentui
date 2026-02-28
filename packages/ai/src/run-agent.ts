import { generateText, stepCountIs, type LanguageModel, type ToolSet } from "ai";
import type { UIEvent } from "@kibadist/agentui-protocol";
import { createUIEmitterTool, UI_EMITTER_TOOL_NAME } from "./tool.js";

export interface RunAgentLoopOptions {
  /** Any AI SDK LanguageModel (OpenAI, Anthropic, Google, etc.) */
  model: LanguageModel;
  /** System message (instructions for the agent) */
  system: string;
  /** Current user message / action description */
  prompt: string;
  /** Allowed component types from your registry */
  allowedTypes: string[];
  /** Session id injected into emitted events */
  sessionId: string;
  /** Called for each valid UI event produced by the model */
  onUIEvent: (event: UIEvent) => void;
  /** Optional: additional tools beyond the UI emitter */
  extraTools?: ToolSet;
  /** Max tool-call steps before stopping (default 10) */
  maxSteps?: number;
}

/**
 * Runs an agent loop using the AI SDK's `generateText` with multi-step
 * tool calling. No manual loop, no JSON.parse, no message management.
 *
 * Works with any AI SDK-compatible model (OpenAI, Anthropic, Google, etc.).
 *
 * Returns the final assistant text (if any).
 */
export async function runAgentLoop(
  opts: RunAgentLoopOptions,
): Promise<string | null> {
  const {
    model,
    system,
    prompt,
    allowedTypes,
    sessionId,
    onUIEvent,
    extraTools = {},
    maxSteps = 10,
  } = opts;

  const uiTool = createUIEmitterTool({ allowedTypes, sessionId, onUIEvent });

  const { text } = await generateText({
    model,
    system,
    prompt,
    tools: {
      [UI_EMITTER_TOOL_NAME]: uiTool,
      ...extraTools,
    },
    stopWhen: stepCountIs(maxSteps),
  });

  return text || null;
}
