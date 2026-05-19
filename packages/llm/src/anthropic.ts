import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import {
  generateId,
  makeAppendTextEvent,
  makeReplaceTextEvent,
  makeReasoningDeltaEvent,
  makeReasoningEndEvent,
  makeReasoningStartEvent,
  makeToastEvent,
  makeToolArgsDeltaEvent,
  makeToolStartEvent,
} from "./shared.js";

export interface FromAdapterOptions {
  sessionId?: string;
  textKey?: string;
}

/**
 * Anthropic Messages API stream event (loose shape — matches @anthropic-ai/sdk
 * docs and types). We type as a discriminated union on `type`.
 */
type AnthropicEvent =
  | { type: "message_start"; message: unknown }
  | {
      type: "content_block_start";
      index: number;
      content_block:
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
        | { type: "thinking"; thinking: string };
    }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string }
        | { type: "thinking_delta"; thinking: string };
    }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta?: { stop_reason?: string } }
  | { type: "message_stop" };

interface BlockState {
  kind: "text" | "tool_use" | "thinking";
  toolId?: string;
  reasoningId?: string;
}

/**
 * Map an Anthropic Messages stream to AgentUI wire events.
 *
 * Text → ui.append (first delta in any text block) + ui.replace for subsequent.
 * Tool use → tool.start + tool.args-delta per chunk.
 * Thinking → reasoning.start / .delta / .end.
 * Errors → ui.toast (level: "error").
 */
export async function* fromAnthropic(
  stream: AsyncIterable<AnthropicEvent>,
  options: FromAdapterOptions = {},
): AsyncIterable<AgentWireEvent> {
  const sessionId = options.sessionId ?? "session";
  const textKey = options.textKey ?? generateId("tb");
  const base = { sessionId };

  const blocks = new Map<number, BlockState>();
  let textBlockStarted = false;
  let accumulatedText = "";

  try {
    for await (const event of stream) {
      switch (event.type) {
        case "message_start":
          break;

        case "content_block_start": {
          const cb = event.content_block;
          if (cb.type === "text") {
            blocks.set(event.index, { kind: "text" });
            if (cb.text !== undefined && cb.text !== "") {
              accumulatedText += cb.text;
              if (!textBlockStarted) {
                textBlockStarted = true;
                yield makeAppendTextEvent(base, textKey, accumulatedText);
              } else {
                yield makeReplaceTextEvent(base, textKey, accumulatedText);
              }
            }
          } else if (cb.type === "tool_use") {
            blocks.set(event.index, { kind: "tool_use", toolId: cb.id });
            const args =
              cb.input && typeof cb.input === "object" && Object.keys(cb.input as object).length > 0
                ? cb.input
                : undefined;
            yield makeToolStartEvent(base, cb.id, cb.name, args);
          } else if (cb.type === "thinking") {
            const reasoningId = generateId("r");
            blocks.set(event.index, { kind: "thinking", reasoningId });
            yield makeReasoningStartEvent(base, reasoningId);
            if (cb.thinking !== undefined && cb.thinking !== "") {
              yield makeReasoningDeltaEvent(base, reasoningId, cb.thinking);
            }
          }
          break;
        }

        case "content_block_delta": {
          const state = blocks.get(event.index);
          if (!state) break;
          const d = event.delta;
          if (d.type === "text_delta" && state.kind === "text") {
            accumulatedText += d.text;
            if (!textBlockStarted) {
              textBlockStarted = true;
              yield makeAppendTextEvent(base, textKey, accumulatedText);
            } else {
              yield makeReplaceTextEvent(base, textKey, accumulatedText);
            }
          } else if (d.type === "input_json_delta" && state.kind === "tool_use" && state.toolId) {
            yield makeToolArgsDeltaEvent(base, state.toolId, d.partial_json);
          } else if (d.type === "thinking_delta" && state.kind === "thinking" && state.reasoningId) {
            yield makeReasoningDeltaEvent(base, state.reasoningId, d.thinking);
          }
          break;
        }

        case "content_block_stop": {
          const state = blocks.get(event.index);
          if (state && state.kind === "thinking" && state.reasoningId) {
            yield makeReasoningEndEvent(base, state.reasoningId);
          }
          break;
        }

        case "message_delta":
        case "message_stop":
          break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield makeToastEvent(base, "error", message);
  }
}
