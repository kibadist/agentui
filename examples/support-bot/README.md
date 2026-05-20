# support-bot

Multi-turn agent example: tool calls, reasoning trace, file upload stub. Mock backend (no real LLM) — the goal is to show the UI patterns, not the LLM wiring.

## Run

```bash
pnpm install
pnpm build
pnpm --filter @kibadist/agentui-example-support-bot dev
# open http://localhost:3011
```

Ask any question. The mock backend will:
1. Echo it back as a user message.
2. Start a `search_kb` tool call (pill appears in the tool-call list).
3. Stream a reasoning trace (visible under "Thinking" disclosure).
4. Render two KB snippet cards.
5. Render the final answer message.

The "Upload" button is a stub — it sends an action with the file name/size; the backend acknowledges with a toast.

## What's inside

- `components/registry.tsx` — `support.message`, `support.kb-snippet`.
- `components/reasoning-panel.tsx` — `useReasoning()` hook in a collapsible.
- `components/tool-calls.tsx` — `useToolCalls()` hook rendering pill badges.
- `app/api/agent/[sessionId]/action/route.ts` — scripted event sequence per action.

## Replacing the mock

Swap the action route handler for one that drives a real LLM (Anthropic / OpenAI / Gemini via `@kibadist/agentui-llm`) and emits the same wire events. The UI is unchanged.

## Limitations

The action handler fires its event sequence with `void runAnswerScript(...)` and no error recovery. A real backend should catch errors and emit a terminal `tool.result` (`status: "error"`) or a `ui.toast` so the UI doesn't appear hung. Demo only.
