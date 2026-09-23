import { validateScenarioDocument, validateScenarioAgainstModel, validateUiModelDocument } from "../contracts/validation.js";
import type { ScenarioDocument, UiModelDocument } from "../contracts/types.js";
import { contentHash } from "../knowledge/store.js";
import { evaluateGate, type ActionDefinition, type Permit } from "../safety/gate.js";

export interface ResolvedTarget { readonly id: string; readonly scope: string; readonly inputConstraints?: Readonly<Record<string, unknown>>; }
export interface ExecutionDriver {
  acquireTabLock(): Promise<() => void>;
  inspectPage(): Promise<{ readonly pageId: string; readonly origin: string; readonly state: string }>;
  resolveTarget(pageId: string, logicalTarget: string): Promise<readonly ResolvedTarget[]>;
  classifyAction(step: Extract<ScenarioDocument["steps"][number], { action: string }>, target: ResolvedTarget): Promise<ActionDefinition>;
  sendAction(step: Extract<ScenarioDocument["steps"][number], { action: string }>, target: ResolvedTarget, value: unknown): Promise<void>;
  observeAction(step: ScenarioDocument["steps"][number]): Promise<boolean>;
  evaluateAssertion(step: Extract<ScenarioDocument["steps"][number], { assert: unknown }>): Promise<boolean>;
}

export interface ExecuteScenarioRequest {
  readonly scenario: unknown;
  readonly models: Readonly<Record<string, unknown>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string | undefined>>;
  readonly permit?: Permit;
  readonly environment: string;
  readonly testMode?: boolean;
  readonly pauseBefore?: string;
  readonly driver: ExecutionDriver;
  readonly now?: Date;
}

export type ExecuteScenarioResult = { readonly status: "passed" | "failed" | "blocked" | "paused" | "ACTION_OUTCOME_UNKNOWN"; readonly completedSteps: readonly string[]; readonly scenarioHash: string; readonly modelHash: string };

export async function executeScenario(request: ExecuteScenarioRequest): Promise<ExecuteScenarioResult> {
  const validated = validateScenarioDocument(request.scenario);
  if (!validated.ok) throw new Error(`invalid Scenario: ${validated.issues.map((issue) => issue.code).join(",")}`);
  const scenario: ScenarioDocument = structuredClone(validated.value);
  if (request.testMode && scenario.status !== "ready") throw new Error("Test Mode requires a ready Scenario");
  if (request.pauseBefore !== undefined && !scenario.steps.some((step) => step.id === request.pauseBefore)) throw new Error("unknown pause Step");
  const models = new Map<string, UiModelDocument>();
  for (const [pageId, raw] of Object.entries(request.models)) {
    const result = validateUiModelDocument(raw);
    if (!result.ok || result.value.page.id !== pageId) throw new Error(`invalid UI Model: ${pageId}`);
    models.set(pageId, structuredClone(result.value));
  }
  const modelFor = (page: string) => {
    const model = models.get(page);
    if (!model) throw new Error(`missing UI Model: ${page}`);
    return model;
  };
  for (const page of new Set([scenario.start_page, ...scenario.steps.map((step) => step.page)])) {
    const pageSteps = scenario.steps.filter((step) => step.page === page);
    const check = validateScenarioAgainstModel({ ...scenario, start_page: page, steps: pageSteps }, modelFor(page));
    if (!check.ok) throw new Error(`Scenario and UI Model mismatch: ${check.issues.map((issue) => issue.code).join(",")}`);
  }
  const declaredInputs = scenario.inputs ?? {};
  for (const [id, definition] of Object.entries(declaredInputs)) {
    const value = request.inputs?.[id];
    if (value === undefined) throw new Error(`missing input: ${id}`);
    if (typeof value !== definition.type) throw new Error(`invalid input type: ${id}`);
  }
  for (const step of scenario.steps) if ("action" in step && step.value && typeof step.value === "object" && "secret" in step.value) {
    if (typeof request.secrets?.[step.value.secret] !== "string") throw new Error(`unresolved secret: ${step.value.secret}`);
  }

  const scenarioHash = contentHash(scenario);
  const modelHash = contentHash(Object.fromEntries([...models.entries()].sort(([a], [b]) => a.localeCompare(b))));
  const completedSteps: string[] = [];
  for (const step of scenario.steps) {
    if (step.id === request.pauseBefore) return { status: "paused", completedSteps, scenarioHash, modelHash };
    if (!("action" in step)) {
      if (!(await request.driver.evaluateAssertion(step))) return { status: "failed", completedSteps, scenarioHash, modelHash };
      completedSteps.push(step.id);
      continue;
    }
    const release = await request.driver.acquireTabLock();
    try {
      const current = await request.driver.inspectPage();
      if (current.pageId !== step.page || current.state !== "ready") return { status: "blocked", completedSteps, scenarioHash, modelHash };
      const matches = await request.driver.resolveTarget(step.page, step.target);
      if (matches.length !== 1) return { status: "blocked", completedSteps, scenarioHash, modelHash };
      const target = matches[0]!;
      const action = await request.driver.classifyAction(step, target);
      if (action.risk === "unknown") return { status: "blocked", completedSteps, scenarioHash, modelHash };
      const binding = contentHash({ targetId: target.id, targetScope: target.scope, inputConstraints: target.inputConstraints ?? null });
      if (action.binding !== undefined && action.binding !== binding) return { status: "blocked", completedSteps, scenarioHash, modelHash };
      const gate = evaluateGate({ ...action, binding }, request.permit, { scenarioHash, modelHash, environment: request.environment, origin: current.origin, now: request.now ?? new Date() });
      if (!gate.allowed) return { status: "blocked", completedSteps, scenarioHash, modelHash };
      const value = step.value && typeof step.value === "object" && "secret" in step.value
        ? request.secrets?.[step.value.secret]
        : step.value && typeof step.value === "object" && "input" in step.value
          ? request.inputs?.[step.value.input]
          : step.value;
      try { await request.driver.sendAction(step, target, value); }
      catch { return { status: "ACTION_OUTCOME_UNKNOWN", completedSteps, scenarioHash, modelHash }; }
      try { if (!(await request.driver.observeAction(step))) return { status: "failed", completedSteps, scenarioHash, modelHash }; }
      catch { return { status: "ACTION_OUTCOME_UNKNOWN", completedSteps, scenarioHash, modelHash }; }
      completedSteps.push(step.id);
    } finally { release(); }
  }
  return { status: scenario.steps.some((step) => "assert" in step) ? "passed" : "failed", completedSteps, scenarioHash, modelHash };
}
