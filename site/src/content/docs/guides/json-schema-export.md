---
title: "JSON Schema export"
description: "Non-TypeScript consumers (Python, Go, OpenAPI tooling) can validate the wire protocol via JSON Schema files shipped in the `@kibadist/agentui-validate` tarball:"
---

- `node_modules/@kibadist/agentui-validate/schema/ui-event.schema.json`
- `node_modules/@kibadist/agentui-validate/schema/ui-node.schema.json`
- `node_modules/@kibadist/agentui-validate/schema/agent-wire-event.schema.json`
- `node_modules/@kibadist/agentui-validate/schema/action-event.schema.json`

The files are regenerated from the Zod schemas via `pnpm schema:generate`. A `pnpm schema:check` script verifies the committed schemas match the Zod source; wire it into your CI to catch drift.

## Related

- [Wire Protocol](../../wire-protocol/)
- [Server companion (Node)](../server-node/)
