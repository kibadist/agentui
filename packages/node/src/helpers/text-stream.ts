import { randomUUID } from "node:crypto";
import type { AgentStream } from "../types.js";

export interface EmitTextStreamOptions {
  /** Optional reasoning-segment id; auto-generated if omitted. */
  reasoningId?: string;
  /** Source of text chunks. Each chunk becomes one reasoning.delta. */
  chunks: AsyncIterable<string>;
}

export async function emitTextStream(
  stream: AgentStream,
  opts: EmitTextStreamOptions,
): Promise<string> {
  const id = opts.reasoningId ?? randomUUID();
  await stream.emit({ op: "reasoning.start", id });
  try {
    for await (const delta of opts.chunks) {
      await stream.emit({ op: "reasoning.delta", id, delta });
    }
    await stream.emit({ op: "reasoning.end", id });
    return id;
  } catch (err) {
    await stream.emit({ op: "reasoning.end", id });
    throw err;
  }
}
