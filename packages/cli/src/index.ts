#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { validateScenarioDocument, validateUiModelDocument } from "./contracts/validation.js";
import { initialize } from "./init.js";

const packageName = "@mugi111/flowui-skills";
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

export async function runCommand(argv: readonly string[]): Promise<{ exitCode: number; output: string }> {
  const [command, kind, file] = argv;
  if (command === "init") {
    await initialize(process.cwd());
    return { exitCode: 0, output: "Initialized .flowui" };
  }
  if (command === "validate") {
    if ((kind !== "model" && kind !== "scenario") || file === undefined) return { exitCode: 2, output: "Usage: flowui validate <model|scenario> <file>" };
    const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
    const result = kind === "model" ? validateUiModelDocument(raw) : validateScenarioDocument(raw);
    return result.ok ? { exitCode: 0, output: "Valid" } : { exitCode: 2, output: JSON.stringify(result.issues) };
  }
  return run(argv);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCommand(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "FlowUI command failed"}\n`);
    process.exitCode = 4;
  });
}
