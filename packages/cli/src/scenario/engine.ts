import type { ScenarioDocument } from "../contracts/types.js";
export type RunStatus = "passed" | "completed" | "failed" | "blocked" | "paused";
export interface ScenarioDriver { act(stepId: string): Promise<"ok" | "blocked">; assert(stepId: string): Promise<boolean>; }
export async function runScenario(scenario: ScenarioDocument, driver: ScenarioDriver, pauseBefore?: string): Promise<RunStatus> {
  let assertions = 0;
  for (const step of scenario.steps) {
    if (step.id === pauseBefore) return "paused";
    if ("action" in step) { if (await driver.act(step.id) === "blocked") return "blocked"; }
    else { assertions += 1; if (!(await driver.assert(step.id))) return "failed"; }
  }
  return assertions > 0 ? "passed" : "completed";
}
