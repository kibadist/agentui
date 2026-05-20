# AgentUI RFCs

Substantial changes to AgentUI go through the RFC ("request for comments") process. The goal: surface design tradeoffs in writing before code lands, so reviewers and future maintainers have context for why the change exists.

## When an RFC is required

Open an RFC if your change is any of:

- **Wire protocol changes** — adding, removing, or modifying any event op (`ui.*`, `tool.*`, `reasoning.*`, `optimistic.*`, `session.*`, `workflow.*`, action event types).
- **Public hook signature changes** — anything exported from a package that touches behavior contract (e.g. `useAgentStream` options, `createAgentStore` signature, `<AgentRoot>` props).
- **New top-level packages** — anything that adds `packages/<name>/` and ships under `@kibadist/`.
- **Major architectural changes** — replacing a transport layer, swapping out the reducer model, changing the registry contract.

You do not need an RFC for:

- Bug fixes that don't change the public API.
- Internal refactors that are invisible to consumers.
- Documentation, test, or tooling changes.
- New components in `examples/`.
- New unit tests.

When in doubt, open a feature request issue first and ask whether an RFC is needed.

## Lifecycle

1. **Draft.** Copy `0000-template.md` to `NNNN-your-short-name.md`. Pick the next free number (look at the highest existing number + 1).
2. **PR.** Open a PR adding only your RFC file. Title: `RFC: <short name>`. Tag the PR with the `rfc` label.
3. **Review.** Required:
   - At least one maintainer approval.
   - At least 5 business days for community input before merge — even if approval lands sooner. This prevents fast-track merges of contentious changes.
4. **Merge or close.**
   - Accepted: merge the RFC. Open an implementation issue and link it from the RFC's frontmatter `implementation:` field.
   - Rejected: close the PR with a comment explaining the decision. Keep the PR open for posterity.
5. **Implement.** Track work under the implementation issue. The PR(s) that implement the RFC should reference the RFC file in their commit messages.
6. **Amend.** If implementation reveals the RFC's design is wrong, open a follow-up PR to either amend the RFC or supersede it with a new one. Do not silently diverge.

## Numbering convention

- Sequential, zero-padded to 4 digits: `0001-foo.md`, `0042-bar.md`.
- Numbers are assigned on PR open, not merge — if two RFCs collide, the later one rebases.
- Short name is kebab-case, descriptive, stable. Avoid version numbers in the name.

## Template

See `0000-template.md`. Required sections: Summary, Motivation, Detailed design, Drawbacks, Alternatives, Prior art, Unresolved questions, Future possibilities. Modeled after the Rust RFC process.

## Active RFCs

(None yet — the protocol is currently evolved via Linear tickets. As external contributors come online, in-flight protocol work will migrate to RFCs.)
