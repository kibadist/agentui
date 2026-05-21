# Public OSS launch checklist

This file tracks the remaining external steps required to flip `@kibadist/agentui-*` from "private-by-convention npm packages" to a public OSS project. Engineering prep landed under DET-158; the items below are the human-coordinated launch tasks.

## Repo

- [x] **Repo is public.** `github.com/kibadist/agentui`.
- [x] **npm scope.** Settled on `@kibadist/agentui-*` (all 10 packages published at 1.0.0 under this scope).
- [x] **GitHub topics.** `agent`, `ai`, `llm`, `react`, `sse`, `streaming`, `typescript`, `ui` applied via `gh repo edit`.
- [ ] **Social preview image.** Upload a 1200×630 PNG in Settings → Social preview. ([DET-166](https://linear.app/detailing-app/issue/DET-166))

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
- [x] **Wire CI.** GitHub Actions workflows live at `.github/workflows/test.yml` (PR + push:main → build → typecheck → test → schema:check) and `.github/workflows/publish.yml` (v*.*.* tag → publishes all 10 packages in dependency order with `--provenance` attestation). Two manual repo-settings steps remain: add the `NPM_TOKEN` secret and set the test workflow as a required status check on main. ([DET-167](https://linear.app/detailing-app/issue/DET-167))
- [ ] **Set up the npm org page.** If using `@kibadist`, verify the npm org is configured as public and has a website + email associated. ([DET-168](https://linear.app/detailing-app/issue/DET-168))

## Docs site

- [ ] **Docs site v1** — Nextra scaffold + content port + hosting at `docs.kibadist.io/agentui`. Covers the stack decision, scaffolding, hostname, and content port (Getting Started, concept guides, examples, migration, changelog). ([DET-169](https://linear.app/detailing-app/issue/DET-169))
- [ ] **API Reference** — typed reference page per published package. Recommended: auto-generate via `@microsoft/api-extractor`. Blocked by DET-169. ([DET-170](https://linear.app/detailing-app/issue/DET-170))
- [ ] **Interactive playground.** StackBlitz iframe rendering `examples/chat-starter` on the docs Getting Started page. Blocked by DET-169. ([DET-171](https://linear.app/detailing-app/issue/DET-171))
- [ ] **SEO polish.** Per-page `<title>`/`<meta description>`, sitemap, OG cards. (Folded into DET-169 as part of Nextra setup; split out if it grows.)

## Launch

- [ ] **Showcase app.** Deploy `examples/support-bot` (or a richer demo) to a public URL. Wire a real LLM behind it (Anthropic via `@kibadist/agentui-llm`'s `fromAnthropic` is the lowest-lift option). ([DET-172](https://linear.app/detailing-app/issue/DET-172))
- [ ] **Blog post.** "Introducing AgentUI" — motivation, the typed-event approach, how it compares to alternatives, code snippet, links to the docs and showcase. ([DET-173](https://linear.app/detailing-app/issue/DET-173))
- [x] **v1.0 release.** Published 2026-05-20. Stability surface in [STABILITY.md](./STABILITY.md), migration in [MIGRATION-1.0.md](./MIGRATION-1.0.md). External-adopter validation moved post-launch — issues with the migration will be tracked under the `stability` label.
- [ ] **Syndication.** HN (Show HN, Tuesday 9-11am PT), Twitter/X thread, Reddit (r/reactjs + r/LocalLLaMA + r/programming), dev.to cross-post. Blocked by DET-166, DET-172, DET-173. ([DET-174](https://linear.app/detailing-app/issue/DET-174))

## Out of scope for this ticket

- Real-time engagement metrics dashboard (post-launch concern).
- Sponsorship / GitHub Sponsors setup.
- Trademark filing for "AgentUI" (if pursued, do it before public launch).
