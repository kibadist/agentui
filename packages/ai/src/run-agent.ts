import {
  generateText,
  stepCountIs,
  type AssistantModelMessage,
  type LanguageModel,
  type ModelMessage,
  type ToolModelMessage,
  type ToolSet,
} from "ai";
import type { UIEvent } from "@kibadist/agentui-protocol";
import { createUIEmitterTool, UI_EMITTER_TOOL_NAME } from "./tool.js";

export type ResponseMessage = AssistantModelMessage | ToolModelMessage;

export interface RunAgentLoopOptions {
  /** Any AI SDK LanguageModel (OpenAI, Anthropic, Google, etc.) */
  model: LanguageModel;
  /** System message (instructions for the agent) */
  system: string;
  /** Single user prompt (first turn). Ignored when `messages` is provided. */
  prompt?: string;
  /** Full conversation history (multi-turn). Takes precedence over `prompt`. */
  messages?: ModelMessage[];
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

export interface RunAgentLoopResult {
  /** Final assistant text (if any) */
  text: string | null;
  /** Response messages generated during this turn (assistant + tool messages) */
  responseMessages: ResponseMessage[];
}

/**
 * Runs an agent loop using the AI SDK's `generateText` with multi-step
 * tool calling. No manual loop, no JSON.parse, no message management.
 *
 * Works with any AI SDK-compatible model (OpenAI, Anthropic, Google, etc.).
 */
export async function runAgentLoop(
  opts: RunAgentLoopOptions,
): Promise<RunAgentLoopResult> {
  const {
    model,
    system,
    messages,
    prompt,
    allowedTypes,
    sessionId,
    onUIEvent,
    extraTools = {},
    maxSteps = 10,
  } = opts;

  const uiTool = createUIEmitterTool({ allowedTypes, sessionId, onUIEvent });
  const tools = {
    [UI_EMITTER_TOOL_NAME]: uiTool,
    ...extraTools,
  };

  const genOpts = messages
    ? { model, system, messages, tools, stopWhen: stepCountIs(maxSteps) }
    : { model, system, prompt: prompt!, tools, stopWhen: stepCountIs(maxSteps) };

  const result = await generateText(genOpts);

  return {
    text: result.text || null,
    responseMessages: result.response.messages,
  };
}
