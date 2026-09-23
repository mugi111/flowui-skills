#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

import { loadDocument } from "./contracts/document.js";
import { validateScenarioAgainstModel, validateScenarioDocument, validateUiModelDocument } from "./contracts/validation.js";
import { initialize } from "./init.js";
import { renderPlaywright } from "./render/playwright.js";
export { executeScenario } from "./scenario/execute.js";
export { RecordCollector } from "./record/collector.js";
export { subscribeBrowserRecord } from "./record/browser.js";
export { createPlaywrightExecutionDriver } from "./scenario/playwright-driver.js";

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
  if (argv.includes("--help") || argv.includes("-h")) return { exitCode: 0, output: usage };
  const [command, kind, file] = argv;
  if (command === "init") {
    if (argv.length !== 1) return { exitCode: 2, output: "Usage: flowui init" };
    await initialize(process.cwd());
    return { exitCode: 0, output: "Initialized .flowui" };
  }
  if (command === "validate") {
    if (argv.length !== 3 || (kind !== "model" && kind !== "scenario") || file === undefined) return { exitCode: 2, output: "Usage: flowui validate <model|scenario> <file>" };
    const raw = await loadDocument(file);
    if (kind === "model") {
      const result = validateUiModelDocument(raw);
      return result.ok ? { exitCode: 0, output: "Valid" } : { exitCode: 2, output: JSON.stringify(result.issues) };
    }
    const result = validateScenarioDocument(raw);
    if (result.ok) {
      const pages = new Set([result.value.start_page, ...result.value.steps.map((step) => step.page)]);
      const issues = [];
      for (const page of pages) {
        const modelPath = join(process.cwd(), ".flowui", "ui-model", `${page}.json`);
        let modelRaw: unknown;
        try { modelRaw = await loadDocument(modelPath); }
        catch { issues.push({ path: `/pages/${page}`, code: "missing-model", message: "referenced Model could not be loaded" }); continue; }
        const model = validateUiModelDocument(modelRaw);
        if (!model.ok) { issues.push(...model.issues); continue; }
        const modelResult = validateScenarioAgainstModel({ ...result.value, steps: result.value.steps.filter((step) => step.page === page), start_page: page }, model.value);
        if (!modelResult.ok) issues.push(...modelResult.issues);
      }
      return issues.length === 0 ? { exitCode: 0, output: "Valid" } : { exitCode: 2, output: JSON.stringify(issues) };
    }
    return { exitCode: 2, output: JSON.stringify(result.issues) };
  }
  if (command === "render" && kind === "playwright") {
    const outputIndex = argv.indexOf("--out");
    if (argv.length !== 3 && !(argv.length === 5 && outputIndex === 3 && argv[4] !== undefined)) return { exitCode: 2, output: "Usage: flowui render playwright <scenario-file> [--out <test-file>]" };
    const scenarioRaw = await loadDocument(file!);
    const scenario = validateScenarioDocument(scenarioRaw);
    if (!scenario.ok) return { exitCode: 2, output: JSON.stringify(scenario.issues) };
    const models: Record<string, import("./contracts/types.js").UiModelDocument> = {};
    const pages = new Set([scenario.value.start_page, ...scenario.value.steps.map((step) => step.page)]);
    for (const page of pages) {
      const modelRaw = await loadDocument(join(process.cwd(), ".flowui", "ui-model", `${page}.json`));
      const model = validateUiModelDocument(modelRaw);
      if (!model.ok) return { exitCode: 2, output: JSON.stringify(model.issues) };
      models[page] = model.value;
    }
    const output = renderPlaywright(scenario.value, models);
    if (outputIndex >= 0) {
      await writeFile(argv[4]!, output, { encoding: "utf8", flag: "wx" });
      return { exitCode: 0, output: `Rendered ${argv[4]}` };
    }
    return { exitCode: 0, output };
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
