import { randomUUID } from "node:crypto";
import type { AgentStream } from "../types.js";

export interface EmitToolCallOptions<R> {
  /** Optional tool-call id; auto-generated if omitted. */
  toolId?: string;
  /** Tool name (registered on the client). */
  name: string;
  /** Initial args payload. */
  args: unknown;
  /** Async function whose resolved value becomes the tool.result. */
  runner: () => Promise<R>;
}

export async function emitToolCall<R>(
  stream: AgentStream,
  opts: EmitToolCallOptions<R>,
): Promise<R> {
  const id = opts.toolId ?? randomUUID();
  await stream.emit({ op: "tool.start", id, name: opts.name, args: opts.args });
  const t0 = Date.now();
  try {
    const result = await opts.runner();
    await stream.emit({
      op: "tool.result",
      id,
      status: "ok",
      result,
      durationMs: Date.now() - t0,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stream.emit({
      op: "tool.result",
      id,
      status: "error",
      error: { message },
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}
