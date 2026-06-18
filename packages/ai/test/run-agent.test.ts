import { describe, it, expect } from "vitest";
import type { LanguageModel } from "ai";
import { runAgentLoop } from "../src/run-agent.js";

describe("runAgentLoop input validation", () => {
  it("throws a clear error when neither `messages` nor `prompt` is supplied", async () => {
    await expect(
      runAgentLoop({
        model: {} as unknown as LanguageModel,
        system: "you are a test",
        allowedTypes: ["Card"],
        sessionId: "s",
        onUIEvent: () => {},
      }),
    ).rejects.toThrow(/requires either `messages` or `prompt`/);
  });
});
