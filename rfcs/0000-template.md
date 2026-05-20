---
rfc: 0000
title: <RFC title here>
start_date: YYYY-MM-DD
authors:
  - <github handle>
implementation: <link to tracking issue once accepted>
---

# Summary

One paragraph explanation of the change. A reader should be able to skim this and decide whether to read further.

# Motivation

Why are we doing this? What use cases does it support? What problem does it solve?

Be specific. "Improve flexibility" is not motivation. "Server consumers building multi-agent dashboards today have to fork the React package because there's no way to scope `useAgentSelector` to a specific agent root — concrete example: detailing-app's `ChatWorkspace.tsx:142`" is.

# Detailed design

The bulk of the RFC. Explain the design in enough detail that:

- A reviewer can identify dark corners and edge cases.
- A future maintainer can understand intent without asking the author.
- An implementer can build it without making additional design decisions.

Include code samples showing new APIs in use. Specify behavior precisely — types, defaults, error modes, edge cases. If wire protocol changes, include the full TypeScript type definitions and the Zod schemas.

# Drawbacks

Why should we not do this?

# Alternatives

What other designs have been considered? What is the impact of not doing this?

# Prior art

Discuss prior art, both the good and the bad, in relation to this proposal. This can include:

- Patterns from other libraries (e.g. how Redux, TanStack Query, tRPC, or Vercel AI SDK handle the same problem).
- Academic papers, blog posts, or specs.
- Earlier discussions in the AgentUI repo.

This section is optional but helps reviewers calibrate.

# Unresolved questions

What parts of the design are still TBD? Open questions are fine to leave for the implementation phase, but call them out explicitly so they are not forgotten.

# Future possibilities

What follow-on work does this enable? Don't propose unrelated features — just note what doors this opens.
