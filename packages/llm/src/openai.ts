import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import {
  generateId,
  makeAppendTextEvent,
  makeReplaceTextEvent,
  makeToastEvent,
  makeToolArgsDeltaEvent,
  makeToolStartEvent,
} from "./shared.js";
import type { FromAdapterOptions } from "./anthropic.js";

/**
 * OpenAI ChatCompletion stream chunk shape.
 * Mirrors `ChatCompletionChunk` from the `openai` SDK (loose typing).
 */
interface OpenAIChunk {
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

interface OpenAIToolState {
  toolId: string;
}

/**
 * Map an OpenAI ChatCompletion stream to AgentUI wire events.
 *
 * Text → ui.append (first non-empty content) + ui.replace for subsequent.
 * Tool calls → tool.start (first chunk per index with id+name) + tool.args-delta
 *   for subsequent arguments fragments.
 * Errors → ui.toast (level: "error").
 *
 * No reasoning support in v0.6.1 (OpenAI's reasoning streams use the
 * separate Responses API, not chat.completions).
 */
export async function* fromOpenAI(
  stream: AsyncIterable<OpenAIChunk>,
  options: FromAdapterOptions = {},
): AsyncIterable<AgentWireEvent> {
  const sessionId = options.sessionId ?? "session";
  const textKey = options.textKey ?? generateId("tb");
  const base = { sessionId };

  let accumulatedText = "";
  let textBlockStarted = false;

  // Tool calls keyed by `index` in the delta array.
  const toolStates = new Map<number, OpenAIToolState>();

  try {
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (!delta) continue;

      // Text content
      if (typeof delta.content === "string" && delta.content !== "") {
        accumulatedText += delta.content;
        if (!textBlockStarted) {
          textBlockStarted = true;
          yield makeAppendTextEvent(base, textKey, accumulatedText);
        } else {
          yield makeReplaceTextEvent(base, textKey, accumulatedText);
        }
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          let state = toolStates.get(idx);
          if (!state) {
            // First chunk for this tool — must have id + function.name.
            if (!tc.id || !tc.function?.name) {
              continue;
            }
            state = { toolId: tc.id };
            toolStates.set(idx, state);
            yield makeToolStartEvent(base, tc.id, tc.function.name);
            // The initial chunk may also contain a non-empty arguments delta.
            if (tc.function.arguments && tc.function.arguments !== "") {
              yield makeToolArgsDeltaEvent(base, tc.id, tc.function.arguments);
            }
          } else {
            // Subsequent chunk: emit arguments delta if present.
            if (tc.function?.arguments) {
              yield makeToolArgsDeltaEvent(base, state.toolId, tc.function.arguments);
            }
          }
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield makeToastEvent(base, "error", message);
  }
}
