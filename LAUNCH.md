# Public OSS launch checklist

This file tracks the remaining external steps required to flip `@kibadist/agentui-*` from "private-by-convention npm packages" to a public OSS project. Engineering prep landed under DET-158; the items below are the human-coordinated launch tasks.

## Repo

- [x] **Repo is public.** `github.com/kibadist/agentui`.
- [x] **npm scope.** Settled on `@kibadist/agentui-*` (all 10 packages published at 1.0.0 under this scope).
- [x] **GitHub topics.** `agent`, `ai`, `llm`, `react`, `sse`, `streaming`, `typescript`, `ui` applied via `gh repo edit`.
- [ ] **Social preview image.** Upload a 1200×630 PNG in Settings → Social preview.

## Repository metadata (already done)

- [x] LICENSE (MIT) at repo root.
- [x] `homepage`, `repository`, `bugs`, `keywords` set on every published `package.json`.
- [x] `CHANGELOG.md` at repo root with the full history (alternative to per-package CHANGELOGs).
- [x] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `STABILITY.md`, `MIGRATION-1.0.md`.
- [x] GitHub issue + PR templates under `.github/`.
- [x] `rfcs/` framework.
- [x] Top-level README sells the library and links to packages, examples, and the RFC process.

## npm

- [x] `scripts/bump-and-publish.sh` now publishes with `--provenance`. Provenance attestation requires running the publish from GitHub Actions; local runs silently fall back to non-attested publishes.
- [ ] **Wire CI.** Add a GitHub Actions workflow that runs `pnpm test && pnpm typecheck && pnpm --filter @kibadist/agentui-validate schema:check` on every PR, and a separate `publish` workflow that calls `./scripts/bump-and-publish.sh patch` on release-tag pushes.
- [ ] **Set up the npm org page.** If using `@kibadist`, verify the npm org is configured as public and has a website + email associated.

## Docs site

- [ ] **Stack decision.** Nextra (recommended — drop-in for Next.js, MDX-native, plays well with the existing repo). Docusaurus is the alternative.
- [ ] **Scaffolding.** Add `docs-site/` to the workspace (or a separate repo) with `pnpm dlx create-nextra-app`.
- [ ] **Hostname.** `docs.kibadist.io/agentui` per the ticket. Requires DNS + Vercel/Netlify project setup.
- [ ] **Content.**
  - [ ] Getting Started (port content from README's quick-start).
  - [ ] Concept guides (sessions, nodes, tool calls, reasoning, optimistic, workflows, capabilities). Most of this content already exists in README sections — port them.
  - [ ] API Reference. Either auto-generate via API Extractor + a doc renderer, or hand-write per-package docs (faster to ship).
  - [ ] Examples — link the three starter dirs from `examples/`.
  - [ ] Migration Guides — link `MIGRATION-1.0.md` and the per-version sections in `CHANGELOG.md`.
  - [ ] Changelog — embed `CHANGELOG.md` or sync per release.
- [ ] **Interactive playground.** A StackBlitz iframe rendering `examples/chat-starter` against the workspace packages. StackBlitz can pull from the public GitHub repo once the repo is public.
- [ ] **SEO.** Per-page `<title>`/`<meta description>`, sitemap, OG cards.

## Launch

- [ ] **Showcase app.** Deploy `examples/support-bot` (or a richer demo) to a public URL. Wire a real LLM behind it (Anthropic via `@kibadist/agentui-llm`'s `fromAnthropic` is the lowest-lift option).
- [ ] **Blog post.** "Introducing AgentUI" — motivation, the typed-event approach, how it compares to alternatives, code snippet, links to the docs and showcase.
- [x] **v1.0 release.** Published 2026-05-20. Stability surface in [STABILITY.md](./STABILITY.md), migration in [MIGRATION-1.0.md](./MIGRATION-1.0.md). External-adopter validation moved post-launch — issues with the migration will be tracked under the `stability` label.
- [ ] **Syndication.**
  - [ ] HN: "Show HN: AgentUI — typed React components for LLM agents" — post Tuesday 9-11am PT for best window.
  - [ ] Twitter/X thread.
  - [ ] Reddit: r/reactjs, r/LocalLLaMA, r/programming.
  - [ ] dev.to cross-post of the blog.

## Out of scope for this ticket

- Real-time engagement metrics dashboard (post-launch concern).
- Sponsorship / GitHub Sponsors setup.
- Trademark filing for "AgentUI" (if pursued, do it before public launch).
