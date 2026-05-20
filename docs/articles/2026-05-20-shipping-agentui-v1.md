# Shipping AgentUI v1: the library upgrade

*An engineering retrospective on taking AgentUI from a working 0.3 prototype to a v1.0-ready OSS package — what motivated the rewrite, what got hard, and what I would do differently.*

---

## Where we started

Eighteen months ago AgentUI was a 4-package monorepo with one job: let an LLM agent emit typed `UIEvent`s through an SSE stream so a React frontend could render them through a whitelisted component registry. The wire protocol covered `ui.append`, `ui.replace`, `ui.remove`, and `ui.toast`. Sessions were UUID-keyed RxJS subjects. Validation was a single `parseUIEvent` call in the NestJS controller. It worked. People used it.

By spring 2026 it had become clear that "it works" wasn't the same as "I'd ship this publicly."

Three problems kept surfacing:

1. **The protocol was incomplete for real agent UIs.** Once an agent emits a tool call that takes 30 seconds to run, you need a `tool.start` / `tool.args-delta` / `tool.result` stream — not just text in a toast. Once a stepper appears (onboarding, troubleshooting, multi-page forms), you need first-class `workflow.*` events. Once a user clicks "Confirm" and waits for the server to round-trip, you need optimistic updates. None of these existed.

2. **Server-side asymmetry.** The React side had `<AgentRoot>`, selector hooks, headless components, devtools, testing helpers. The server side was: write JSON to `res` and hope. If you used NestJS the package shipped a controller factory; if you used anything else you were on your own.

3. **Nothing was stable.** Every minor cut could have been a breaking change because there was no documented surface, no semver promise, no migration guide. Adopters were brave.

The plan was to fix all three over six weeks, then cut v1.0.

## How the work was organized

I used a process I've been refining for a while: brainstorm → spec → plan → execute via subagents → two-stage review per task → commit. Every ticket — every single one, even the "trivial" ones — got the full pipeline.

The shape of one ticket looked like this:

```
brainstorm   : 5-10 min   talk through the design with the model
spec         : 15 min     write a 200-line design doc, commit
plan         : 20-30 min  decompose into 5-10 tasks with exact code
execute      : 1-3 hours  dispatch one fresh subagent per task
review       : 10 min/task spec compliance review, then code quality review
fixes        : variable   send the same subagent back to fix issues
mark done    : 1 min      update Linear, move on
```

About 60 tickets went through this in three months. The longest was the `@kibadist/agentui-node` server companion (DET-154 — nine tasks, a fresh package with sse-writer, conversation persistence, and helpers). The shortest were OSS launch metadata changes that finished in ten minutes.

## What we actually shipped

The v0.8 + v0.9 milestones added, in rough order:

- **Capabilities handshake** — server declares available node types, accepted actions, and permissions as the first event. `useCapabilities()` + `requires` on the registry gates UI by permission.
- **Tool calls** — full slice with `useToolCall`, `<ToolCallStream>`, streaming args via `parsePartialJson`.
- **Reasoning streams** — extended-thinking gets its own slice with `useReasoning` / `useLatestReasoning`.
- **Optimistic updates** — `optimistic.apply` / `confirm` / `rollback` with `useOptimistic(entityKey)`.
- **Workflows** — `workflow.start` / `advance` / `complete` / `cancel` with `<WorkflowStepper>` + `useWorkflow`.
- **`<AgentRoot>`** — single top-level provider that handles session, history rehydration, and selector context.
- **Multi-agent namespacing** — nest `<AgentRoot id="planner">` and target with `useAgentNodes('planner')`.
- **Stream resilience** — opt-in retry with jitter, bounded backpressure, auth-aware reconnect.
- **Memory caps + metrics** — bounded slices, FNV-hashed session tags, plug a `MetricEmitter`.
- **DevTools panel** — time-travel state inspector at `/devtools` subpath, zero bundle cost when not imported.
- **`@kibadist/agentui-node`** — framework-agnostic server primitives. Express, Fastify, Hono, raw `node:http`, Next.js Route Handlers — pick one, the same `createAgentStream` / `createAgentReadable` works.
- **`@kibadist/agentui-llm`** — provider-native adapters: `fromAnthropic`, `fromOpenAI`, `fromGemini`. Peer-dep the SDKs.
- **JSON Schema export** — Python and Go consumers can validate the wire protocol without TypeScript.
- **Schema-first nodes** — `defineNode({ type, schema, component })` infers props from Zod.
- **CLI generator** — `npx @kibadist/agentui new-node QuoteCard` scaffolds the component + schema + test + registry entry.
- **Starter templates** — three reference apps (`chat-starter`, `support-bot`, `internal-tools`) that run standalone.
- **Governance** — Contributor Covenant, RFC framework modeled on Rust RFCs, issue/PR templates.
- **Stability surface** — `STABILITY.md` documents the contract, `MIGRATION-1.0.md` covers the one 0.x → 1.0 breaking change (`initialAgentState` constant → `createInitialAgentState()` factory).

## Challenges

### Subagents over-build by default

The biggest single source of friction was subagents adding "obvious" features that weren't in the spec. A plan to add a `Conversation` class with `append` and `history` came back with a `delete` method, a `query` method, and a TTL system. None were asked for.

What worked: explicit "out of scope" sections in the spec, and a **spec compliance review subagent** dispatched after the implementer. The spec reviewer's only job is "did they build what was asked, no more and no less" — it caught half a dozen scope-creep adds I would have missed in a single review pass. The code quality reviewer then handles the orthogonal "is what they built well-built" question.

The two reviewers find different problems. Skipping either lets bugs through.

### The plan is the contract

Vague plan steps produce vague code. A step that says "add appropriate error handling" gets you whatever error handling the implementer felt like writing. A step that says "if `res.write` returns false, await the `drain` event before continuing" gets you that exact code.

I rewrote my plan template to require: exact file paths, complete code in every step, exact commands with expected output, exact commit messages. No "implement the rest similarly to Task N" — repeat the code, because the implementer may be reading tasks out of order or in a fresh context.

This sounds tedious. It's faster. A 200-line plan with complete code took me 25 minutes to write and the implementer 15 minutes to execute correctly. A 50-line plan with sketchy steps took 10 minutes to write and 90 minutes of back-and-forth to land.

### Verbatim migrations beat editorial improvements

The last task — splitting the 942-line README into 22 docs pages — taught a lesson I wasn't expecting. My first instinct was to also clean up the prose during the migration: tighten taglines, fix the `claude-sonnet-4-5` reference, improve a few examples. The subagent did some of this on its own.

It went badly. Every editorial change has to be reviewed for fidelity to the source, defended against the next reviewer who has a different opinion, and lived with forever. The "improvements" I made in the first pass got reverted in the second pass because the reviewer correctly flagged them as drift.

The right call was: migrate verbatim now, edit later as a separate pass with its own review. The structural change (where content lives) and the editorial change (how content is worded) are different decisions and deserve different reviews.

### Backwards compat through twenty tickets

Every minor release between 0.3 and 0.9 had to leave the previous version's consumers working. The deprecation path I'm proudest of: when we replaced `initialAgentState` (a constant) with `createInitialAgentState()` (a factory), we kept both for four minors before removing the constant in the v1.0 prep. The constant got a `@deprecated` JSDoc, the migration guide got a single grep-and-replace recipe, and the test that used the constant got a regression test for the factory.

This is unglamorous but it's the difference between a library people upgrade and a library people abandon at 0.5.0 because the upgrade hurt.

### LLM adapter peer-deps

Originally `@kibadist/agentui-llm` direct-depended on `@anthropic-ai/sdk`, `openai`, and `@google/generative-ai`. That meant anyone installing the package pulled all three SDKs whether they needed one or all. Bundle bloat, version conflicts, and `npm install` time all suffered.

Switching them to peer deps was a half-day fix and a one-line CHANGELOG entry, but it required ripping out fancy "auto-detect provider" logic. The simpler design — three exports (`fromAnthropic`, `fromOpenAI`, `fromGemini`), each importing its own SDK lazily — is better in every way. The cleverness was overhead.

## Lessons that generalize

**Plans should look like code that hasn't been written yet.** If you can't write out the exact lines, you don't understand the problem well enough to delegate it. Discovery happens during planning, not during implementation.

**Two reviewers catch different things.** Spec compliance and code quality are orthogonal. One agent can't reliably hold both lenses at once.

**Saying "I would not have caught that" is the point.** The reviewers caught: a Mermaid emoji typo, a tagline that duplicated a body sentence, a wrong package count in a badge, a forgotten ReadableStream `cancel()` unsubscribe, a heartbeat that crashed on dead sockets, a JSON Schema cross-check that missed half the wire ops. None of these were in my plan. All of them were bugs.

**Process beats heroics.** Sixty tickets in three months wasn't grinding; it was a pipeline that mostly ran without me. The hard work was building the pipeline. The execution was almost mechanical once the spec and plan were sharp.

**Be willing to delete cleverness.** The auto-detect LLM adapter, the runtime-evaluated workflow conditions, the over-engineered `Conversation.delete` method — all of these got cut before they shipped. None were missed.

## What's left for v1.0

The engineering for v1.0 stabilization is done. The remaining items are external — they're tracked in `LAUNCH.md`:

- Make the GitHub repo public
- Stand up the docs site at `docs.kibadist.io/agentui` (Nextra)
- Wire CI (no GitHub Actions exist yet)
- Deploy a showcase app with a real LLM behind it
- Write the "Introducing AgentUI" launch post
- Wait for at least one external consumer to confirm migration is clean before cutting the major bump

That last point is the gate I keep coming back to. v1.0 is a promise to other developers, and you can't make it credibly until someone outside your own machine has tried the migration and reported back. So the next milestone isn't a code change — it's getting one real adopter through the upgrade and listening to what hurt.

The hard part wasn't the rewrite. It's the listening that comes next.

---

*AgentUI is open-source at [github.com/kibadist/agentui](https://github.com/kibadist/agentui). The full changelog is in [CHANGELOG.md](../../CHANGELOG.md); the stability promise is in [STABILITY.md](../../STABILITY.md); the 1.0 migration in [MIGRATION-1.0.md](../../MIGRATION-1.0.md).*
