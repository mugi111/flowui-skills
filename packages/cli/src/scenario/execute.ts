import { validateScenarioDocument, validateScenarioAgainstModel, validateUiModelDocument } from "../contracts/validation.js";
import type { InputConstraints, ScenarioDocument, UiModelDocument } from "../contracts/types.js";
import { contentHash } from "../knowledge/store.js";
import { evaluateGate, type Permit } from "../safety/gate.js";
import { classifySensitivity, type RedactionPolicy } from "../shared/redaction.js";

export interface ResolvedTarget { readonly id: string; readonly scope: string; readonly inputConstraints?: InputConstraints; }
export interface ExecutionDriver {
  acquireTabLock(): Promise<() => void>;
  inspectPage(): Promise<{ readonly pageId: string; readonly origin: string; readonly state: string }>;
  resolveTarget(pageId: string, logicalTarget: string): Promise<readonly ResolvedTarget[]>;
  sendAction(step: Extract<ScenarioDocument["steps"][number], { action: string }>, target: ResolvedTarget, value: unknown, expectedOrigin: string): Promise<void>;
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
  readonly redactionPolicy?: RedactionPolicy;
  readonly pauseBefore?: string;
  readonly driver: ExecutionDriver;
  readonly now?: Date;
}

export type ExecuteScenarioResult = { readonly status: "passed" | "failed" | "blocked" | "paused" | "ACTION_OUTCOME_UNKNOWN"; readonly completedSteps: readonly string[]; readonly scenarioHash: string; readonly modelHash: string };

export async function executeScenario(request: ExecuteScenarioRequest): Promise<ExecuteScenarioResult> {
  if (request.permit !== undefined && !isWellFormedPermit(request.permit)) throw new Error("invalid Permit");
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
  for (const step of scenario.steps) {
    if (!("action" in step) || !["fill", "select", "press"].includes(step.action)) continue;
    const element = modelFor(step.page).elements[step.target];
    const sensitivity = classifySensitivity({ targetId: step.target, ...(element === undefined ? {} : { name: element.name, ...(element.inputType === undefined ? {} : { inputType: element.inputType }), ...(element.autocomplete === undefined ? {} : { autocomplete: element.autocomplete }) }) }, request.redactionPolicy);
    const secretValue = step.value !== undefined && typeof step.value === "object" && "secret" in step.value;
    if (sensitivity === "sensitive" && !secretValue) throw new Error(`sensitive target requires a secret reference: ${step.target}`);
    if (sensitivity === "unknown" && !secretValue) throw new Error(`unknown target sensitivity requires a secret reference: ${step.target}`);
  }
  const declaredInputs = scenario.inputs ?? {};
  for (const [id, definition] of Object.entries(declaredInputs)) {
    const value = request.inputs?.[id];
    if (value === undefined) throw new Error(`missing input: ${id}`);
    if (typeof value !== definition.type) throw new Error(`invalid input type: ${id}`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`invalid input value: ${id}`);
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
      const value = step.value && typeof step.value === "object" && "secret" in step.value
        ? request.secrets?.[step.value.secret]
        : step.value && typeof step.value === "object" && "input" in step.value
          ? request.inputs?.[step.value.input]
          : step.value;
      if ((step.action === "fill" || step.action === "select") && !satisfiesConstraints(value, target.inputConstraints)) return { status: "blocked", completedSteps, scenarioHash, modelHash };
      let navigationDestination: string | null = null;
      if (step.action === "navigate") {
        if (typeof value !== "string") return { status: "blocked", completedSteps, scenarioHash, modelHash };
        try {
          const destination = new URL(value, current.origin);
          if (destination.origin !== current.origin || destination.username || destination.password) return { status: "blocked", completedSteps, scenarioHash, modelHash };
          navigationDestination = destination.toString();
        } catch { return { status: "blocked", completedSteps, scenarioHash, modelHash }; }
      }
      const action = { id: step.id, risk: "mutation" as const, targetScope: target.scope };
      const binding = contentHash({ targetId: target.id, targetScope: target.scope, inputConstraints: target.inputConstraints ?? null, navigationDestination });
      const gate = evaluateGate({ ...action, binding }, request.permit, { scenarioHash, modelHash, environment: request.environment, origin: current.origin, now: request.now ?? new Date() });
      if (!gate.allowed) return { status: "blocked", completedSteps, scenarioHash, modelHash };
      try { await request.driver.sendAction(step, target, value, current.origin); }
      catch { return { status: "ACTION_OUTCOME_UNKNOWN", completedSteps, scenarioHash, modelHash }; }
      try { if (!(await request.driver.observeAction(step))) return { status: "failed", completedSteps, scenarioHash, modelHash }; }
      catch { return { status: "ACTION_OUTCOME_UNKNOWN", completedSteps, scenarioHash, modelHash }; }
      completedSteps.push(step.id);
    } finally { release(); }
  }
  return { status: scenario.steps.some((step) => "assert" in step) ? "passed" : "failed", completedSteps, scenarioHash, modelHash };
}

function satisfiesConstraints(value: unknown, constraints: InputConstraints | undefined): boolean {
  if (!constraints) return true;
  if (typeof value !== "string") return false;
  if (constraints.required && value.length === 0) return false;
  if (constraints.minLength !== undefined && value.length < constraints.minLength) return false;
  if (constraints.maxLength !== undefined && value.length > constraints.maxLength) return false;
  if (constraints.pattern !== undefined) {
    try { if (!new RegExp(`^(?:${constraints.pattern})$`).test(value)) return false; }
    catch { return false; }
  }
  return true;
}

function isWellFormedPermit(raw: unknown): raw is Permit {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const permit = raw as Record<string, unknown>;
  const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  if (!nonEmpty(permit.scenarioHash) || !nonEmpty(permit.modelHash) || !nonEmpty(permit.environment) || !nonEmpty(permit.origin) || !nonEmpty(permit.expiresAt)) return false;
  if (!Array.isArray(permit.actionIds) || !permit.actionIds.every(nonEmpty) || !Array.isArray(permit.targetScopes) || !permit.targetScopes.every(nonEmpty)) return false;
  if (permit.actionBindings !== undefined && (!permit.actionBindings || typeof permit.actionBindings !== "object" || Array.isArray(permit.actionBindings) || Object.values(permit.actionBindings).some((value) => !nonEmpty(value)))) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(permit.expiresAt) || !Number.isFinite(Date.parse(permit.expiresAt))) return false;
  try {
    const origin = new URL(permit.origin);
    return (origin.protocol === "https:" || origin.protocol === "http:") && origin.origin === permit.origin && origin.pathname === "/" && !origin.search && !origin.hash && !origin.username && !origin.password;
  } catch { return false; }
}
