import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import {
  generateId,
  makeAppendTextEvent,
  makeReplaceTextEvent,
  makeToastEvent,
  makeToolStartEvent,
} from "./shared.js";
import type { FromAdapterOptions } from "./anthropic.js";

/** Gemini GenerateContentResponse (loose shape). */
interface GeminiChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<
        | { text: string }
        | { functionCall: { name: string; args?: unknown } }
      >;
    };
    finishReason?: string;
  }>;
}

/**
 * Map a Gemini generateContentStream to AgentUI wire events.
 *
 * Text → ui.append (first non-empty text) + ui.replace as more text arrives.
 *   Gemini's stream chunks each carry the full accumulated text in `parts`,
 *   so the adapter emits the full text in each replace (not a delta).
 * Function calls → tool.start with complete args (Gemini emits the full
 *   functionCall once it's resolved; no streaming args).
 * Errors → ui.toast (level: "error").
 *
 * No reasoning support in v0.6.1 (Gemini's reasoning is not yet stable in
 * the streaming API).
 */
export async function* fromGemini(
  stream: AsyncIterable<GeminiChunk>,
  options: FromAdapterOptions = {},
): AsyncIterable<AgentWireEvent> {
  const sessionId = options.sessionId ?? "session";
  const textKey = options.textKey ?? generateId("tb");
  const base = { sessionId };

  let accumulatedText = "";
  let textBlockStarted = false;
  const emittedFunctionCalls = new Set<string>();

  try {
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;

      for (const part of candidate.content.parts) {
        if ("text" in part && typeof part.text === "string") {
          const chunkText = part.text;
          if (chunkText.length > accumulatedText.length && chunkText.startsWith(accumulatedText)) {
            accumulatedText = chunkText;
            if (!textBlockStarted) {
              textBlockStarted = true;
              yield makeAppendTextEvent(base, textKey, accumulatedText);
            } else {
              yield makeReplaceTextEvent(base, textKey, accumulatedText);
            }
          } else if (chunkText !== accumulatedText) {
            accumulatedText = chunkText;
            if (!textBlockStarted) {
              textBlockStarted = true;
              yield makeAppendTextEvent(base, textKey, accumulatedText);
            } else {
              yield makeReplaceTextEvent(base, textKey, accumulatedText);
            }
          }
        } else if ("functionCall" in part && part.functionCall) {
          const fc = part.functionCall;
          const dedupeKey = `${fc.name}:${JSON.stringify(fc.args ?? null)}`;
          if (emittedFunctionCalls.has(dedupeKey)) continue;
          emittedFunctionCalls.add(dedupeKey);
          const toolId = generateId("tool");
          yield makeToolStartEvent(base, toolId, fc.name, fc.args);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield makeToastEvent(base, "error", message);
  }
}
