export const HELP_TEXT = `agentui — scaffold AgentUI components

Usage:
  agentui new-node <PascalCaseName> [--dry-run]
  agentui --help
  agentui --version

Commands:
  new-node    Scaffold a new component (tsx + zod schema + test + registry entry)

Options:
  --dry-run   Print what would happen without writing files
  --help, -h  Show this help
  --version,  Print version

Config (optional, project root):
  agentui.config.json
    {
      "registry": "./components/registry.ts",
      "componentsDir": "./components"
    }
`;

export function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}
