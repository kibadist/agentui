# Docs restructure: README → index + topical docs pages

**Status:** Approved
**Date:** 2026-05-20
**Tracking:** Repo housekeeping (post-DET-158; not a Linear ticket)

## Goal

Shrink `README.md` from 942 lines to a focused ~150-line landing page that pitches the project and links into a structured `docs/` tree. Move the deep feature content from README into per-topic markdown pages, copied verbatim. No content rewriting in this pass.

## Motivation

- README has accumulated 24 distinct H3 feature sections as the library shipped tickets. It now reads as a wall of content — hard to scan, hard to maintain, intimidating on first contact.
- There is no separation between "what is this project" (landing concerns) and "how do I use feature X" (reference concerns). Both compete for the same scroll.
- `LAUNCH.md` commits to a Nextra docs site at `docs.kibadist.io/agentui`. A `docs/` tree in repo is the natural staging ground; porting markdown to Nextra later is mechanical.
- Per-package READMEs (`packages/*/README.md`) stay short and reference-card shaped; cross-cutting topics (wire protocol, getting started, packages overview) need their own home.

## Non-goals

- No Nextra/Docusaurus scaffolding. The docs site is a separate launch task.
- No content rewriting or editorial pass. Sections are lifted verbatim, with header levels adjusted so each page is a self-contained `# Title` document.
- No API reference auto-generation (API Extractor, etc.).
- No screenshots beyond the existing demo GIF.
- No restructuring of `packages/*/README.md` — they stay as-is.
- No changes to `docs/superpowers/` — that directory is reserved for design specs and plans.

## Directory layout

```
README.md                          # ~150 lines, landing + docs index
docs/
  README.md                        # docs index (mirror of links, for browsing inside docs/)
  getting-started.md
  concepts.md
  wire-protocol.md
  packages.md
  use-cases.md
  roadmap.md
  guides/
    agent-root.md
    renderer.md
    state-selectors.md
    tool-calls.md
    reasoning.md
    workflows.md
    optimistic.md
    schema-first-nodes.md
    stream-resilience.md
    memory-caps.md
    testing.md
    devtools.md
    server-node.md
    llm-adapters.md
    json-schema-export.md
    cli-generator.md
```

22 new markdown files total (1 docs index + 6 top-level pages + 15 guide pages). Existing files at repo root (`README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `STABILITY.md`, `MIGRATION-1.0.md`, `LAUNCH.md`, `CHANGELOG.md`, `LICENSE`) are unchanged in location.

## Content mapping

Every new doc page sources its content from a specific README section. Source line ranges below refer to the current `README.md` at HEAD.

| Destination | Source (README.md) | Content |
|---|---|---|
| `docs/getting-started.md` | 790–848 | Prereqs, install, dev server, "Example Prompts" |
| `docs/concepts.md` | 17–125 | The Problem, The Solution, How It Works (4-step walkthrough) |
| `docs/wire-protocol.md` | 127–226, 780–787 | Supported UI Operations, JSON Patch payloads, Streaming partial-JSON, Capabilities handshake, Resetting a conversation, Dropping the protocol direct dep |
| `docs/packages.md` | 850–902 | Packages table + Mermaid dep graph |
| `docs/use-cases.md` | 906–915 | Use Cases section |
| `docs/roadmap.md` | 918–925 | Roadmap section |
| `docs/guides/agent-root.md` | 449–504 | Quick start with `<AgentRoot>` + multi-agent namespacing |
| `docs/guides/renderer.md` | 228–245 | `AgentRenderer` props (range, filter, hiddenTypes, errorFallback, nodeWrapper) |
| `docs/guides/state-selectors.md` | 247–277 | `AgentStateProvider` + `useAgent*` selector hooks |
| `docs/guides/tool-calls.md` | 279–317 | `ToolCallStream`, `useToolCall(s)` |
| `docs/guides/reasoning.md` | 319–351 | `useReasoning`, `useLatestReasoning` |
| `docs/guides/workflows.md` | 353–401 | `WorkflowStepper`, `useWorkflow` |
| `docs/guides/optimistic.md` | 403–447 | `useOptimistic`, `useOptimisticAll` |
| `docs/guides/schema-first-nodes.md` | 670–698 | `defineNode` |
| `docs/guides/stream-resilience.md` | 700–718 | Retry, backpressure, auth-aware reconnect |
| `docs/guides/memory-caps.md` | 720–751 | `caps` + `onMetric` + tags |
| `docs/guides/testing.md` | 753–778 | `createMockAgentStream`, `pushEvent`, `replayConversation`, `createTestRegistry` |
| `docs/guides/devtools.md` | 611–639 | `AgentDevTools` panel |
| `docs/guides/server-node.md` | 533–599 | `@kibadist/agentui-node` (`createAgentStream`, `createAgentReadable`, `Conversation`, helpers) |
| `docs/guides/llm-adapters.md` | 506–531 | `@kibadist/agentui-llm` adapters (`fromAnthropic`, `fromOpenAI`, `fromGemini`) |
| `docs/guides/json-schema-export.md` | 600–609 | JSON Schema files from `@kibadist/agentui-validate` |
| `docs/guides/cli-generator.md` | 641–668 | `npx @kibadist/agentui new-node` |

The README sections at lines 1–16 (title + badges + tagline + demo GIF) and 928–942 (Contributing, License) stay in the new `README.md`.

## New README.md shape

The post-migration `README.md` has these sections in order:

1. **Title + badges** (TypeScript, License, pnpm, packages).
2. **One-line pitch** + **demo GIF** (existing markup, unchanged).
3. **Problem/Solution** condensed to two paragraphs (was 50 lines, becomes ~10).
4. **Flow diagram** (existing Mermaid block, unchanged).
5. **Quick example** — one compact code block showing agent tool call → registry → render, linking to `docs/getting-started.md` and `docs/concepts.md` for the full walkthrough.
6. **Documentation** — bulleted index linking into `docs/`:
   - Getting Started
   - Concepts
   - Wire Protocol
   - Guides (with sub-bullets for each of the 15 guide pages)
   - Packages
   - Use Cases
   - Roadmap
7. **Packages** — keep the existing 7-row table (it's the most useful single artifact in the README and answers "what do I install"). Link to `docs/packages.md` for the dep graph.
8. **Starter templates** — keep the existing table (3 rows), already short.
9. **Contributing** — keep the existing block.
10. **License** — keep.

Target line count: 140–160. (Current: 942.)

## Per-page conventions

Each new doc page follows the same shape:

```markdown
# <Title>

> One-line tagline pulled from the README section, or "Part of the AgentUI docs — see [index](../README.md)."

<content lifted from README, with H3 (###) headers in the source promoted to H2 (##) since the page is now self-contained>

## Related

- Link to 1–3 adjacent guide pages (e.g., the tool-calls guide links to reasoning and optimistic)
- Link back to `../README.md` (docs index) and `../../README.md` (project README)
```

Header level adjustment: each source section is an H3 (`###`) in README. When lifted into its own page, the page title becomes H1 (`# <Title>`), and any H4 sub-sections inside the section become H2 (`##`). No content edits beyond header level.

The "Related" footer is the only added content; the rest is verbatim from README.

## docs/README.md (docs-internal index)

A 30-line index mirroring the project README's Documentation section. Lets contributors browsing the `docs/` tree on GitHub orient themselves without having to click back up. Content is exclusively links — same bullet structure as in the main README.

## Internal links

Three classes of link to fix:

1. **Cross-references between guides.** Add "Related" footers (3 links max per page) on each guide. Mapping is in the implementation plan.
2. **Links from new README → docs.** Use relative paths: `./docs/getting-started.md`, `./docs/guides/workflows.md`.
3. **Links from existing repo files.** `CONTRIBUTING.md`, `STABILITY.md`, `MIGRATION-1.0.md` currently reference README sections by anchor (e.g., `[See the Capabilities section](./README.md#capabilities-handshake)`). Search the codebase for such anchors and rewrite to point at the new doc pages.

Anchors inside the README that go away (e.g., `#workflows--steppers`) and currently have external referrers from `CONTRIBUTING.md` / `STABILITY.md` / `LAUNCH.md` / package READMEs must be rewritten. The plan includes an explicit grep step.

## Validation

After migration:

1. `wc -l README.md` — must be under 200.
2. Spot-check the new README renders cleanly on GitHub (open in a preview or push to a branch).
3. Manual link check: walk every link in the new README and `docs/README.md`. None should 404.
4. Manual link check: grep for `README.md#` anchors across the repo, ensure each one resolves to a still-present section or has been rewritten.
5. `pnpm test` + `pnpm typecheck` — confirm no code changes leaked in.

No automated link checker is added in this pass; that's a separate concern.

## Approach for execution

A single mechanical migration, sequenced as:

1. Create `docs/` skeleton (empty files in the correct directory layout) so cross-page link targets exist before any content lands.
2. Migrate top-level pages (`getting-started`, `concepts`, `wire-protocol`, `packages`, `use-cases`, `roadmap`) in alphabetical order — each lifts one or more README sections verbatim with header adjustments.
3. Migrate guide pages in the same alphabetical order — same pattern.
4. Write `docs/README.md` index.
5. Rewrite `README.md` to its new shape.
6. Sweep external referrers (CONTRIBUTING.md, STABILITY.md, MIGRATION-1.0.md, LAUNCH.md, package READMEs) for stale anchors and rewrite to new doc paths.
7. Validate (line count, link check, tests).
8. Commit in two units:
   - **Commit 1:** add all `docs/` files (top-level pages + guides + `docs/README.md`). Repo still has the old `README.md`, so links from external referrers still work; new docs/ tree is additive.
   - **Commit 2:** rewrite `README.md` to its new shape and sweep external referrers in CONTRIBUTING/STABILITY/MIGRATION/LAUNCH/package READMEs.

Two-commit split keeps each commit reviewable on its own and means commit 1 alone is non-breaking if commit 2 needs rework.

## Risk + mitigation

- **Risk: lost content.** Mitigation: the content mapping table is exhaustive; reviewer confirms every section in current README has a destination.
- **Risk: broken external links** (GitHub stargazers' bookmarks, blog posts that link to `README.md#workflows`). Mitigation: add 301-style notes in the new README's documentation section (e.g., "Workflows moved to `docs/guides/workflows.md`"). Acceptable churn for a project still at 0.x.
- **Risk: out-of-date cross-references inside docs.** Mitigation: relative links throughout; no absolute URLs to GitHub.

## Estimated diff size

- `README.md`: −800 lines (942 → ~150).
- New: 22 files, average ~50 lines each (~1,100 lines total — but lifted verbatim, not new authoring).
- Net repo line count: roughly +250 lines (the docs index header on each page + "Related" footers).
