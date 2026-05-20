# CLI generator

Scaffold a typed AgentUI component in one command:

```bash
npx @kibadist/agentui new-node QuoteCard
```

Creates `quote-card.tsx`, `quote-card.schema.ts`, and `quote-card.test.tsx` (plus `quote-card.stories.tsx` when Storybook is detected), and inserts a registry entry between the marker comments.

Optional config at `agentui.config.json`:

```json
{
  "registry": "./components/registry.ts",
  "componentsDir": "./components"
}
```

One-time setup in your registry file:

```ts
// agentui:registry-imports-start
// agentui:registry-imports-end

export const registry = createRegistry({
  // agentui:registry-entries-start
  // agentui:registry-entries-end
});
```

## Related

- [Schema-first nodes](./schema-first-nodes.md)
