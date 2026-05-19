import { printHelp } from "./commands/help.js";
import { runNewNode } from "./commands/new-node.js";

const VERSION = "0.0.0";

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (args[0] === "new-node") {
    const name = args[1];
    const dryRun = args.includes("--dry-run");
    if (!name) {
      process.stderr.write("Usage: agentui new-node <PascalCaseName> [--dry-run]\n");
      return 1;
    }
    const result = runNewNode({ name, dryRun }, process.cwd());
    if (!result.ok) {
      process.stderr.write(result.error + "\n");
      return 1;
    }
    const verb = dryRun ? "Would create" : "Created";
    for (const f of result.created) {
      process.stdout.write(`  ${verb}: ${f}\n`);
    }
    process.stdout.write(`  ${verb} registry entry in registry file\n`);
    if (result.storybook) {
      process.stdout.write(`  Detected Storybook (${result.storybook}) — story scaffolded\n`);
    }
    if (!dryRun) {
      process.stdout.write(`\nNext: run \`${result.pkgManager} test\`\n`);
    }
    return 0;
  }
  process.stderr.write(`Unknown command: ${args[0]}\n\n`);
  printHelp();
  return 1;
}

process.exit(main(process.argv));
