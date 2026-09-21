#!/usr/bin/env node

const packageName = "@company/flowui-skills";
const version = "0.1.0";

const usage = `FlowUI Skills ${version}

Usage:
  flowui <command>

Commands:
  init                  Initialize a .flowui directory (planned)
  session               Manage a browser session (planned)
  inspect               Observe the visible UI (planned)
  capture               Create a UI Model candidate (planned)
  record                Record user operations (planned)
  validate              Validate a UI Model or Scenario (planned)
  resolve-target        Resolve a logical target (planned)
  permit                Create an action permit (planned)
  run                   Execute a Scenario (planned)
  render playwright     Render a Playwright test (planned)

Run \`flowui <command> --help\` for command-specific help once that command is available.`;

export function run(argv: readonly string[]): { exitCode: number; output: string } {
  const [command] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    return { exitCode: 0, output: usage };
  }

  if (command === "--version" || command === "-v") {
    return { exitCode: 0, output: version };
  }

  return {
    exitCode: 2,
    output: `${packageName}: unsupported command \`${command}\`\n\n${usage}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = run(process.argv.slice(2));
  process.stdout.write(`${result.output}\n`);
  process.exitCode = result.exitCode;
}
import { fileURLToPath } from "node:url";
