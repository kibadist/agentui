---
title: "Schema-first nodes"
description: "Define a node's type, schema, component, and capability requirements in one call — props are inferred from the Zod schema and emit-time validation is automatic."
---

```ts
import { z } from "zod";
import { defineNode, createRegistry } from "@kibadist/agentui-react";

const QuoteCardNode = defineNode({
  type: "quote-card",
  schema: z.object({
    quoteId: z.string(),
    total: z.number(),
  }),
  component: QuoteCard,
  requires: ["quotes.read"],
});

export const registry = createRegistry([QuoteCardNode]);

// Server side:
emit({ op: "ui.append", node: QuoteCardNode.build({
  key: "q-1",
  props: { quoteId: "Q-1", total: 1200 },
})});
```

The legacy object form `createRegistry({ "type": { component, propsSchema } })` continues to work.

## Related

- [Renderer](../renderer/)
- [Wire Protocol](../../wire-protocol/)
