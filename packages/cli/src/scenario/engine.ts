import type { ScenarioDocument } from "../contracts/types.js";
export type RunStatus = "passed" | "completed" | "failed" | "blocked" | "paused";
export interface ScenarioDriver {
  beforeAction(stepId: string): Promise<"ok" | "blocked">;
  act(stepId: string): Promise<"ok" | "blocked">;
  assert(stepId: string): Promise<boolean>;
}
export async function runScenario(scenario: ScenarioDocument, driver: ScenarioDriver, pauseBefore?: string): Promise<RunStatus> {
  if (pauseBefore !== undefined && !scenario.steps.some((step) => step.id === pauseBefore)) throw new Error(`unknown pause step: ${pauseBefore}`);
  let assertions = 0;
  for (const step of scenario.steps) {
    if (step.id === pauseBefore) return "paused";
    if ("action" in step) { if (await driver.beforeAction(step.id) === "blocked" || await driver.act(step.id) === "blocked") return "blocked"; }
    else { assertions += 1; if (!(await driver.assert(step.id))) return "failed"; }
  }
  return assertions > 0 ? "passed" : "completed";
}
