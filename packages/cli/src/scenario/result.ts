import { contentHash } from "../knowledge/store.js";
import type { ScenarioDocument, UiModelDocument } from "../contracts/types.js";
import type { RunStatus } from "./engine.js";
export interface RunResult { readonly runId: string; readonly status: RunStatus; readonly scenarioHash: string; readonly modelHashes: Readonly<Record<string,string>>; readonly resumedFrom?: string; }
export function createRunResult(status: RunStatus, scenario: ScenarioDocument, models: readonly UiModelDocument[], resumedFrom?: string): RunResult {
  return { runId: crypto.randomUUID(), status, scenarioHash: contentHash(scenario), modelHashes: Object.fromEntries(models.map((model)=>[model.page.id, model.revision])), ...(resumedFrom === undefined ? {} : { resumedFrom }) };
}
