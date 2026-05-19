import { printHelp } from "./commands/help.js";

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
  process.stderr.write(`Unknown command: ${args[0]}\n\n`);
  printHelp();
  return 1;
}

process.exit(main(process.argv));
