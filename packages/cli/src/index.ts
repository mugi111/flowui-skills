#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { loadDocument } from "./contracts/document.js";
import type { ScenarioDocument, UiModelDocument } from "./contracts/types.js";
import { validateScenarioAgainstModel, validateScenarioDocument, validateUiModelDocument } from "./contracts/validation.js";
import { initialize } from "./init.js";
import { renderPlaywright } from "./render/playwright.js";
import { requestSession, runSessionDaemon } from "./session/daemon.js";
import { createCaptureCandidate } from "./knowledge/capture.js";
import { storeUiModel } from "./knowledge/store.js";
import { createPermit } from "./safety/permit.js";
export { executeScenario } from "./scenario/execute.js";
export { RecordCollector } from "./record/collector.js";
export { subscribeBrowserRecord } from "./record/browser.js";
export { createPlaywrightExecutionDriver } from "./scenario/playwright-driver.js";
export { createPermit } from "./safety/permit.js";

const packageName = "@mugi111/flowui-skills";
const version = "0.1.0";

async function safeRequestSession(request: Parameters<typeof requestSession>[1]): Promise<Awaited<ReturnType<typeof requestSession>>> {
  try { return await requestSession(process.cwd(), request); }
  catch { return { ok: false, error: request.method === "start" ? "SESSION_START_FAILED" : "SESSION_NOT_FOUND" }; }
}

const usage = `FlowUI Skills ${version}

Usage:
  flowui <command>

Commands:
  init                  Initialize a .flowui directory
  session               Start, inspect, or close the persistent browser session
  inspect               Observe the active browser tab
  capture               Create or accept a UI Model candidate
  record                Start or stop redacted browser recording
  validate              Validate a UI Model or Scenario
  permit create         Create an origin-, Scenario-, Model-, Target-, and expiry-bound Permit
  resolve-target        Resolve a logical target uniquely in the active tab
  run                   Execute a Scenario through the Safety Gate
  render playwright     Generate a Playwright Test

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
  if (command === "_session-daemon") {
    if (argv.length !== 2) return { exitCode: 2, output: "Invalid internal Session Service invocation" };
    await runSessionDaemon(argv[1]!);
    return { exitCode: 0, output: "Session Service stopped" };
  }
  if (command === "session") {
    if (argv.length !== 2 || !["start", "status", "close"].includes(kind ?? "")) return { exitCode: 2, output: "Usage: flowui session <start|status|close>" };
    const method = kind as "start" | "status" | "close";
    const response = await safeRequestSession({ method });
    return response.ok ? { exitCode: 0, output: JSON.stringify(response.result) } : { exitCode: 2, output: response.error ?? "Session Service error" };
  }
  if (command === "inspect") {
    const tabFlag = argv.indexOf("--tab");
    if (argv.length !== 1 && !(argv.length === 3 && tabFlag === 1 && argv[2])) return { exitCode: 2, output: "Usage: flowui inspect [--tab <id>]" };
    const response = await safeRequestSession({ method: "inspect", ...(tabFlag < 0 ? {} : { tabId: argv[2] }) });
    return response.ok ? { exitCode: 0, output: JSON.stringify(response.result) } : { exitCode: 2, output: response.error ?? "Session Service error" };
  }
  if (command === "resolve-target") {
    const pageId = argv[1]; const targetId = argv[2]; const tabFlag = argv.indexOf("--tab");
    if (!pageId || !targetId || (argv.length !== 3 && !(argv.length === 5 && tabFlag === 3 && argv[4]))) return { exitCode: 2, output: "Usage: flowui resolve-target <page-id> <target-id> [--tab <id>]" };
    const modelPath = join(process.cwd(), ".flowui", "ui-model", `${pageId}.json`);
    const model = validateUiModelDocument(await loadDocument(modelPath));
    if (!model.ok || model.value.page.id !== pageId) return { exitCode: 2, output: model.ok ? `Model page mismatch: ${pageId}` : JSON.stringify(model.issues) };
    const response = await safeRequestSession({ method: "resolve-target", pageId, targetId, models: { [pageId]: model.value }, ...(tabFlag < 0 ? {} : { tabId: argv[4] }) });
    if (!response.ok) return { exitCode: 2, output: response.error ?? "Target resolution failed" };
    const matches = response.result as readonly unknown[];
    return matches.length === 1 ? { exitCode: 0, output: JSON.stringify(matches[0]) } : { exitCode: 2, output: JSON.stringify({ kind: matches.length === 0 ? "unresolved" : "ambiguous", matches }) };
  }
  if (command === "record") {
    if (argv.length === 2 && kind === "start") {
      const response = await safeRequestSession({ method: "record-start" });
      return response.ok ? { exitCode: 0, output: "Recording started" } : { exitCode: 2, output: response.error ?? "Record error" };
    }
    if (argv.length === 3 && kind === "stop" && file) {
      const response = await safeRequestSession({ method: "record-stop" });
      if (!response.ok) return { exitCode: 2, output: response.error ?? "Record error" };
      await writeFile(file, `${JSON.stringify(response.result, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return { exitCode: 0, output: `Recorded events saved to ${file}` };
    }
    return { exitCode: 2, output: "Usage: flowui record start | flowui record stop <events-file>" };
  }
  if (command === "capture" && kind === "accept") {
    if ((argv.length !== 3 && !(argv.length === 5 && argv[3] === "--revision" && argv[4])) || !file) return { exitCode: 2, output: "Usage: flowui capture accept <candidate-file> [--revision <expected-revision>]" };
    const candidate = await loadDocument(file);
    if (!candidate || typeof candidate !== "object" || !("model" in candidate) || !candidate.model || typeof candidate.model !== "object") return { exitCode: 2, output: "Invalid capture candidate" };
    const rawModel = candidate.model as Record<string, unknown>;
    const model = validateUiModelDocument({ ...rawModel, revision: "capture-candidate" });
    if (!model.ok) return { exitCode: 2, output: JSON.stringify(model.issues) };
    const writeMode = argv.length === 5 ? { mode: "update" as const, expectedRevision: argv[4]! } : { mode: "create" as const };
    const stored = await storeUiModel(process.cwd(), model.value, writeMode);
    return stored.kind === "stored" ? { exitCode: 0, output: JSON.stringify(stored) } : { exitCode: 2, output: JSON.stringify(stored) };
  }
  if (command === "capture") {
    const tabFlag = argv.indexOf("--tab");
    const pageId = argv[1];
    if (!pageId || !/^[a-z][a-z0-9-]*$/.test(pageId) || (argv.length !== 2 && !(argv.length === 4 && tabFlag === 2 && argv[3]))) return { exitCode: 2, output: "Usage: flowui capture <page-id> [--tab <id>]" };
    const response = await safeRequestSession({ method: "capture", ...(tabFlag < 0 ? {} : { tabId: argv[3] }) });
    if (!response.ok) return { exitCode: 2, output: response.error ?? "Capture error" };
    const observation = response.result as import("./observation/observe.js").PageObservation;
    const firstHeading = observation.headings.find((heading) => heading.text.trim().length > 0);
    const definition = { id: pageId, landmarks: firstHeading ? [{ role: "heading" as const, name: firstHeading.text }] : [] };
    const candidate = createCaptureCandidate(observation, [definition]);
    await mkdir(join(process.cwd(), ".flowui", "candidates"), { recursive: true });
    const candidatePath = join(process.cwd(), ".flowui", "candidates", `${pageId}-${crypto.randomUUID()}.json`);
    await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { exitCode: 0, output: JSON.stringify({ path: candidatePath, candidate }) };
  }
  if (command === "permit" && kind === "create") {
    const scenarioFile = argv[2];
    if (!scenarioFile) return { exitCode: 2, output: "Usage: flowui permit create <scenario-file> --origin <origin> --expires <utc> --steps <step-ids> --out <permit-file> [--env <environment>]" };
    const options = new Map<string, string>();
    const allowed = new Set(["--origin", "--expires", "--steps", "--out", "--env"]);
    for (let index = 3; index < argv.length; index += 2) {
      const flag = argv[index]; const value = argv[index + 1];
      if (!flag || !allowed.has(flag) || !value || options.has(flag)) return { exitCode: 2, output: "Invalid permit arguments" };
      options.set(flag, value);
    }
    for (const required of ["--origin", "--expires", "--steps", "--out"]) if (!options.has(required)) return { exitCode: 2, output: `Missing ${required}` };
    const scenarioResult = validateScenarioDocument(await loadDocument(scenarioFile));
    if (!scenarioResult.ok) return { exitCode: 2, output: JSON.stringify(scenarioResult.issues) };
    if (scenarioResult.value.status !== "ready") return { exitCode: 2, output: "Permit creation requires a ready Scenario" };
    const models: Record<string, UiModelDocument> = {};
    for (const page of new Set([scenarioResult.value.start_page, ...scenarioResult.value.steps.map((step) => step.page)])) {
      const model = validateUiModelDocument(await loadDocument(join(process.cwd(), ".flowui", "ui-model", `${page}.json`)));
      if (!model.ok || model.value.page.id !== page) return { exitCode: 2, output: model.ok ? `Model page mismatch: ${page}` : JSON.stringify(model.issues) };
      models[page] = model.value;
      const refs = validateScenarioAgainstModel({ ...scenarioResult.value, start_page: page, steps: scenarioResult.value.steps.filter((step) => step.page === page) }, model.value);
      if (!refs.ok) return { exitCode: 2, output: JSON.stringify(refs.issues) };
    }
    const permit = createPermit(scenarioResult.value, models, { origin: options.get("--origin")!, expiresAt: options.get("--expires")!, environment: options.get("--env") ?? "test", stepIds: options.get("--steps")!.split(",").map((id) => id.trim()).filter(Boolean) });
    await writeFile(options.get("--out")!, `${JSON.stringify(permit, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { exitCode: 0, output: `Permit saved to ${options.get("--out")}` };
  }
  if (command === "run") {
    const scenarioFile = argv[1];
    if (scenarioFile === undefined) return { exitCode: 2, output: "Usage: flowui run <scenario-file> [--tab <id>] [--permit <file>] [--pause-before <step-id>]" };
    const allowedFlags = new Set(["--tab", "--permit", "--pause-before"]);
    const options = new Map<string, string>();
    for (let index = 2; index < argv.length; index += 2) {
      const flag = argv[index];
      const value = argv[index + 1];
      if (!flag || !allowedFlags.has(flag) || !value || options.has(flag)) return { exitCode: 2, output: "Invalid run arguments" };
      options.set(flag, value);
    }
    const raw = await loadDocument(scenarioFile);
    const scenarioResult = validateScenarioDocument(raw);
    if (!scenarioResult.ok) return { exitCode: 2, output: JSON.stringify(scenarioResult.issues) };
    const scenario = scenarioResult.value;
    const models: Record<string, UiModelDocument> = {};
    for (const page of new Set([scenario.start_page, ...scenario.steps.map((step) => step.page)])) {
      const modelRaw = await loadDocument(join(process.cwd(), ".flowui", "ui-model", `${page}.json`));
      const model = validateUiModelDocument(modelRaw);
      if (!model.ok || model.value.page.id !== page) return { exitCode: 2, output: model.ok ? `Model page mismatch: ${page}` : JSON.stringify(model.issues) };
      models[page] = model.value;
      const pageSteps = scenario.steps.filter((step) => step.page === page);
      const references = validateScenarioAgainstModel({ ...scenario, start_page: page, steps: pageSteps }, model.value);
      if (!references.ok) return { exitCode: 2, output: JSON.stringify(references.issues) };
    }
    const inputs: Record<string, string> = {};
    for (const id of Object.keys(scenario.inputs ?? {})) {
      const value = process.env[`FLOWUI_INPUT_${id.replace(/-/g, "_").toUpperCase()}`];
      if (value !== undefined) inputs[id] = value;
    }
    const secrets: Record<string, string | undefined> = {};
    for (const step of scenario.steps) if ("action" in step && step.value && typeof step.value === "object" && "secret" in step.value) {
      const reference = step.value.secret;
      const environmentKey = reference.startsWith("env:") ? reference.slice(4) : reference;
      secrets[reference] = process.env[environmentKey];
    }
    let permit: import("./safety/gate.js").Permit | undefined;
    const permitPath = options.get("--permit");
    if (permitPath) permit = await loadDocument(permitPath) as import("./safety/gate.js").Permit;
    const response = await safeRequestSession({ method: "run", scenario: scenario as ScenarioDocument, models, inputs, secrets, environment: process.env.FLOWUI_ENV ?? "test", testMode: true, ...(options.get("--tab") ? { tabId: options.get("--tab")! } : {}), ...(options.get("--pause-before") ? { pauseBefore: options.get("--pause-before")! } : {}), ...(permit === undefined ? {} : { permit }) });
    if (!response.ok) return { exitCode: 2, output: response.error ?? "Session Service error" };
    const result = response.result as { status?: string };
    return { exitCode: result.status === "passed" ? 0 : 1, output: JSON.stringify(response.result) };
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
