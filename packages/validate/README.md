# @kibadist/agentui-validate

Runtime validation for the AgentUI protocol using Zod.

## Install

```bash
npm install @kibadist/agentui-validate
```

## Usage

### Safe parsing (recommended)

```ts
import { safeParseUIEvent } from "@kibadist/agentui-validate";

const result = safeParseUIEvent(rawData);
if (result.ok) {
  // result.value is a typed UIEvent
  console.log(result.value.op);
} else {
  console.error(result.error);
}
```

### Strict parsing (throws on invalid data)

```ts
import { parseUIEvent, parseActionEvent } from "@kibadist/agentui-validate";

const uiEvent = parseUIEvent(raw);       // throws ZodError if invalid
const action = parseActionEvent(raw);     // throws ZodError if invalid
```

### Type guards

```ts
import { isUIEvent, isActionEvent } from "@kibadist/agentui-validate";

if (isUIEvent(data)) {
  // data is UIEvent
}
```

### Zod schemas

```ts
import { uiEventSchema, actionEventSchema, uiNodeSchema } from "@kibadist/agentui-validate";

// Use directly with Zod
const parsed = uiEventSchema.parse(data);

// Compose into larger schemas
const mySchema = z.object({
  event: uiEventSchema,
  metadata: z.record(z.unknown()),
});
```

## Exports

| Export | Kind | Description |
|---|---|---|
| `parseUIEvent` | function | Parse and validate a UIEvent, throws on failure |
| `safeParseUIEvent` | function | Parse a UIEvent, returns `{ ok, value }` or `{ ok, error }` |
| `parseActionEvent` | function | Parse and validate an ActionEvent, throws on failure |
| `safeParseActionEvent` | function | Parse an ActionEvent, returns `{ ok, value }` or `{ ok, error }` |
| `isUIEvent` | function | Type guard for UIEvent |
| `isActionEvent` | function | Type guard for ActionEvent |
| `uiEventSchema` | Zod schema | Validates all UI event types |
| `actionEventSchema` | Zod schema | Validates all action event types |
| `uiNodeSchema` | Zod schema | Validates UINode structure |

## License

MIT
