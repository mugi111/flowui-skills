import type { ScenarioDocument, UiModelDocument } from "../contracts/types.js";
import { validateScenarioDocument, validateUiModelDocument } from "../contracts/validation.js";

export function renderPlaywright(scenarioInput: ScenarioDocument, modelInputs: Readonly<Record<string, UiModelDocument>>): string {
  const scenarioResult = validateScenarioDocument(scenarioInput);
  if (!scenarioResult.ok || scenarioResult.value.status !== "ready") throw new Error("Playwright Test generation requires a valid, ready Scenario");
  const fixedModels: Record<string, UiModelDocument> = {};
  for (const pageId of new Set([scenarioResult.value.start_page, ...scenarioResult.value.steps.map((step) => step.page)])) {
    const modelResult = validateUiModelDocument(modelInputs[pageId]);
    if (!modelResult.ok || modelResult.value.page.id !== pageId) throw new Error(`a valid fixed Model is required for Page ${pageId}`);
    fixedModels[pageId] = modelResult.value;
  }
  const scenario = JSON.stringify(scenarioResult.value, null, 2);
  const models = JSON.stringify(fixedModels, null, 2);
  const inputs = Object.keys(scenarioResult.value.inputs ?? {}).map((id) => `${JSON.stringify(id)}: process.env[${JSON.stringify(`FLOWUI_INPUT_${id.replace(/-/g, "_").toUpperCase()}`)}]`).join(",\n    ");
  const secretRefs = scenarioResult.value.steps.flatMap((step) => "action" in step && step.value && typeof step.value === "object" && "secret" in step.value ? [step.value.secret] : []);
  const secrets = [...new Set(secretRefs)].map((reference) => {
    const key = reference.startsWith("env:") ? reference.slice(4) : reference;
    return `${JSON.stringify(reference)}: process.env[${JSON.stringify(key)}]`;
  }).join(",\n    ");
  return `import { test } from "@playwright/test";
import { executeScenario, createPlaywrightExecutionDriver } from "@mugi111/flowui-skills";

const scenario = ${scenario} as const;
const models = ${models} as const;

test(${JSON.stringify(scenarioResult.value.id)}, async ({ page }) => {
  const permit = process.env.FLOWUI_PERMIT ? JSON.parse(process.env.FLOWUI_PERMIT) : undefined;
  const result = await executeScenario({
    scenario,
    models,
    inputs: { ${inputs} },
    secrets: { ${secrets} },
    permit,
    environment: process.env.FLOWUI_ENV ?? "test",
    testMode: true,
    driver: createPlaywrightExecutionDriver(page, models),
  });
  if (result.status !== "passed") throw new Error("Scenario did not pass: " + result.status);
});
`;
}
