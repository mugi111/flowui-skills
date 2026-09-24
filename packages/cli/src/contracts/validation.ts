import type {
  ActionName,
  AssertionType,
  ScenarioDocument,
  ScenarioStep,
  UiModelDocument,
  ValidationIssue,
  ValidationResult,
} from "./types.js";
import { schemaVersion } from "./types.js";

const actionNames = new Set<ActionName>(["click", "fill", "select", "check", "uncheck", "press", "navigate"]);
const assertionTypes = new Set<AssertionType>([
  "visible",
  "hidden",
  "enabled",
  "disabled",
  "text",
  "value",
  "url",
  "page",
  "state",
  "row-count",
]);
const safeId = /^[a-z][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): string | undefined {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0) {
    issues.push({ path: `${path}/${key}`, code: "required-string", message: "must be a non-empty string" });
    return undefined;
  }
  return candidate;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push({ path: `${path}/${key}`, code: "unknown-key", message: "is not permitted" });
    }
  }
}

function validateId(value: string | undefined, path: string, issues: ValidationIssue[]): void {
  if (value !== undefined && !safeId.test(value)) {
    issues.push({ path, code: "invalid-id", message: "must use lowercase kebab-case" });
  }
}

function validateInputs(raw: unknown, issues: ValidationIssue[]): ReadonlyMap<string, boolean> {
  const sensitiveInputs = new Map<string, boolean>();
  if (raw === undefined) return sensitiveInputs;
  if (!isRecord(raw)) {
    issues.push({ path: "/inputs", code: "invalid-inputs", message: "must be an object" });
    return sensitiveInputs;
  }
  for (const [id, definition] of Object.entries(raw)) {
    validateId(id, `/inputs/${id}`, issues);
    if (isRecord(definition)) hasOnlyKeys(definition, ["type", "sensitive"], `/inputs/${id}`, issues);
    if (!isRecord(definition) || (definition.type !== "string" && definition.type !== "number" && definition.type !== "boolean") || typeof definition.sensitive !== "boolean") {
      issues.push({ path: `/inputs/${id}`, code: "invalid-input-definition", message: "must define a type and sensitive flag" });
      continue;
    }
    sensitiveInputs.set(id, definition.sensitive);
  }
  return sensitiveInputs;
}

function validateStep(rawStep: unknown, index: number, sensitiveInputs: ReadonlyMap<string, boolean>, issues: ValidationIssue[]): ScenarioStep | undefined {
  const path = `/steps/${index}`;
  if (!isRecord(rawStep)) {
    issues.push({ path, code: "invalid-type", message: "must be an object" });
    return undefined;
  }

  const id = stringAt(rawStep, "id", path, issues);
  const page = stringAt(rawStep, "page", path, issues);
  validateId(id, `${path}/id`, issues);
  const hasAction = "action" in rawStep;
  const hasAssertion = "assert" in rawStep;
  if (hasAction === hasAssertion) {
    issues.push({ path, code: "step-kind", message: "must contain exactly one of action or assert" });
    return undefined;
  }

  if (hasAction) {
    hasOnlyKeys(rawStep, ["id", "page", "action", "target", "value"], path, issues);
    const action = rawStep.action;
    const target = stringAt(rawStep, "target", path, issues);
    if (typeof action !== "string" || !actionNames.has(action as ActionName)) {
      issues.push({ path: `${path}/action`, code: "invalid-action", message: "must be a supported action" });
      return undefined;
    }
    if (["fill", "select", "press", "navigate"].includes(action) && rawStep.value === undefined) {
      issues.push({ path: `${path}/value`, code: "missing-action-value", message: "this action requires a value" });
    }
    if (["click", "check", "uncheck"].includes(action) && rawStep.value !== undefined) {
      issues.push({ path: `${path}/value`, code: "unexpected-action-value", message: "this action does not accept a value" });
    }
    if (rawStep.value !== undefined && !isRecord(rawStep.value) && rawStep.value !== null && (!["string", "number", "boolean"].includes(typeof rawStep.value) || (typeof rawStep.value === "number" && !Number.isFinite(rawStep.value)))) {
      issues.push({ path: `${path}/value`, code: "invalid-value", message: "must be a string, number, boolean, or reference" });
    }
    if (isRecord(rawStep.value)) {
      const valueKeys = Object.keys(rawStep.value);
      if (valueKeys.length !== 1 || (valueKeys[0] !== "input" && valueKeys[0] !== "secret")) {
        issues.push({ path: `${path}/value`, code: "invalid-value-reference", message: "must be one input or secret reference" });
      } else if (valueKeys[0] === "input") {
        const inputId = rawStep.value.input;
        if (typeof inputId !== "string" || !sensitiveInputs.has(inputId)) {
          issues.push({ path: `${path}/value/input`, code: "unknown-input", message: "must reference a declared input" });
        } else if (sensitiveInputs.get(inputId)) {
          issues.push({ path: `${path}/value/input`, code: "sensitive-input-reference", message: "a sensitive input must use a secret reference" });
        }
      } else if (typeof rawStep.value.secret !== "string" || rawStep.value.secret.length === 0) {
        issues.push({ path: `${path}/value/secret`, code: "invalid-secret-reference", message: "must be a non-empty secret reference" });
      }
    }
    if (target === undefined || id === undefined || page === undefined) return undefined;
    return { id, page, action: action as ActionName, target, ...(rawStep.value === undefined ? {} : { value: rawStep.value as never }) };
  }

  hasOnlyKeys(rawStep, ["id", "page", "assert", "expectation"], path, issues);
  if (!isRecord(rawStep.assert)) {
    issues.push({ path: `${path}/assert`, code: "invalid-type", message: "must be an object" });
    return undefined;
  }
  const assertion = rawStep.assert;
  hasOnlyKeys(assertion, ["type", "target", "equals"], `${path}/assert`, issues);
  const type = assertion.type;
  const target = stringAt(assertion, "target", `${path}/assert`, issues);
  if (typeof type !== "string" || !assertionTypes.has(type as AssertionType)) {
    issues.push({ path: `${path}/assert/type`, code: "invalid-assertion", message: "must be a supported assertion" });
  }
  const expectation = rawStep.expectation;
  if (!isRecord(expectation)) {
    issues.push({ path: `${path}/expectation`, code: "missing-expectation", message: "must have a user-intent reference" });
    return undefined;
  }
  if (expectation.source !== "user-intent" || typeof expectation.reference !== "string" || expectation.reference.length === 0) {
    issues.push({ path: `${path}/expectation`, code: "missing-expectation", message: "must have a user-intent reference" });
  }
  hasOnlyKeys(expectation, ["source", "reference"], `${path}/expectation`, issues);
  if (assertion.equals !== undefined && !["string", "number", "boolean"].includes(typeof assertion.equals)) issues.push({ path: `${path}/assert/equals`, code: "invalid-equals", message: "must be a string, number, or boolean" });
  if (["text", "value", "url", "row-count", "state"].includes(String(type)) && assertion.equals === undefined) issues.push({ path: `${path}/assert/equals`, code: "required-equals", message: "this assertion requires an expected value" });
  if (type === "row-count" && (typeof assertion.equals !== "number" || !Number.isSafeInteger(assertion.equals) || assertion.equals < 0)) issues.push({ path: `${path}/assert/equals`, code: "invalid-row-count", message: "must be a non-negative integer" });
  if (type === "state" && assertion.equals !== "observed" && assertion.equals !== "unknown") issues.push({ path: `${path}/assert/equals`, code: "invalid-state", message: "must be observed or unknown" });
  if (id === undefined || page === undefined || target === undefined || typeof type !== "string" || !assertionTypes.has(type as AssertionType)) return undefined;
  return {
    id,
    page,
    assert: { type: type as AssertionType, target, ...(assertion.equals === undefined ? {} : { equals: assertion.equals as string | number | boolean }) },
    expectation: { source: "user-intent", reference: expectation.reference as string },
  };
}

export function validateScenarioDocument(raw: unknown): ValidationResult<ScenarioDocument> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(raw)) return { ok: false, issues: [{ path: "/", code: "invalid-type", message: "must be an object" }] };
  hasOnlyKeys(raw, ["schema_version", "id", "status", "intent", "start_page", "inputs", "steps"], "", issues);
  if (raw.schema_version !== schemaVersion) issues.push({ path: "/schema_version", code: "unsupported-version", message: `must equal ${schemaVersion}` });
  const id = stringAt(raw, "id", "", issues);
  const intent = stringAt(raw, "intent", "", issues);
  const startPage = stringAt(raw, "start_page", "", issues);
  validateId(id, "/id", issues);
  validateId(startPage, "/start_page", issues);
  if (raw.status !== "draft" && raw.status !== "ready") issues.push({ path: "/status", code: "invalid-status", message: "must be draft or ready" });
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) issues.push({ path: "/steps", code: "invalid-steps", message: "must be a non-empty array" });
  const sensitiveInputs = validateInputs(raw.inputs, issues);
  const steps = Array.isArray(raw.steps) ? raw.steps.map((step, index) => validateStep(step, index, sensitiveInputs, issues)).filter((step): step is ScenarioStep => step !== undefined) : [];
  const stepIds = new Set<string>();
  for (const step of steps) {
    if (stepIds.has(step.id)) issues.push({ path: "/steps", code: "duplicate-step-id", message: `duplicate step id ${step.id}` });
    stepIds.add(step.id);
  }
  if (raw.status === "ready" && !steps.some((step) => "assert" in step)) {
    issues.push({ path: "/steps", code: "ready-requires-assertion", message: "a ready Scenario needs at least one assertion" });
  }
  if (issues.length > 0 || id === undefined || intent === undefined || startPage === undefined || (raw.status !== "draft" && raw.status !== "ready")) return { ok: false, issues };
  const inputs = raw.inputs === undefined ? undefined : raw.inputs as NonNullable<ScenarioDocument["inputs"]>;
  return { ok: true, value: { schema_version: schemaVersion, id, status: raw.status, intent, start_page: startPage, ...(inputs === undefined ? {} : { inputs }), steps } };
}

export function validateUiModelDocument(raw: unknown): ValidationResult<UiModelDocument> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(raw)) return { ok: false, issues: [{ path: "/", code: "invalid-type", message: "must be an object" }] };
  hasOnlyKeys(raw, ["schema_version", "page", "revision", "elements"], "", issues);
  if (raw.schema_version !== schemaVersion) issues.push({ path: "/schema_version", code: "unsupported-version", message: `must equal ${schemaVersion}` });
  if (!isRecord(raw.page) || !isRecord(raw.page.identity)) {
    issues.push({ path: "/page", code: "invalid-page", message: "must include page identity" });
  }
  if (isRecord(raw.page)) {
    hasOnlyKeys(raw.page, ["id", "name", "identity"], "/page", issues);
    if (typeof raw.page.id !== "string" || !safeId.test(raw.page.id)) issues.push({ path: "/page/id", code: "invalid-id", message: "must use lowercase kebab-case" });
    if (typeof raw.page.name !== "string" || raw.page.name.length === 0) issues.push({ path: "/page/name", code: "required-string", message: "must be a non-empty string" });
    if (isRecord(raw.page.identity)) {
      hasOnlyKeys(raw.page.identity, ["landmarks"], "/page/identity", issues);
      const landmarks = raw.page.identity.landmarks;
      if (!Array.isArray(landmarks) || landmarks.length === 0) issues.push({ path: "/page/identity/landmarks", code: "invalid-landmarks", message: "must be a non-empty array" });
      else landmarks.forEach((landmark, index) => {
        if (!isRecord(landmark) || typeof landmark.role !== "string" || !["heading", "main", "navigation", "banner", "contentinfo", "form", "region"].includes(landmark.role) || typeof landmark.name !== "string" || landmark.name.trim().length === 0) {
          issues.push({ path: `/page/identity/landmarks/${index}`, code: "invalid-landmark", message: "must define a supported role and non-empty name" });
        } else hasOnlyKeys(landmark, ["role", "name"], `/page/identity/landmarks/${index}`, issues);
      });
    }
  }
  if (typeof raw.revision !== "string" || raw.revision.length === 0) issues.push({ path: "/revision", code: "required-string", message: "must be a non-empty string" });
  if (!isRecord(raw.elements)) issues.push({ path: "/elements", code: "invalid-elements", message: "must be an object" });
  else for (const [id, element] of Object.entries(raw.elements)) {
    if (!safeId.test(id) || !isRecord(element) || (element.state !== "observed" && element.state !== "unknown") || typeof element.role !== "string" || typeof element.name !== "string" || (element.inputType !== undefined && typeof element.inputType !== "string") || (element.autocomplete !== undefined && typeof element.autocomplete !== "string")) issues.push({ path: `/elements/${id}`, code: "invalid-element", message: "must define state, role, and name" });
    else {
      hasOnlyKeys(element, ["state", "role", "name", "inputType", "autocomplete", "inputConstraints", "targetAliases"], `/elements/${id}`, issues);
      if (element.targetAliases !== undefined && (!Array.isArray(element.targetAliases) || element.targetAliases.some((alias) => typeof alias !== "string" || alias.length === 0))) issues.push({ path: `/elements/${id}/targetAliases`, code: "invalid-target-aliases", message: "must be an array of non-empty strings" });
      if (element.inputConstraints !== undefined) {
        const constraints = element.inputConstraints;
        if (!isRecord(constraints)) issues.push({ path: `/elements/${id}/inputConstraints`, code: "invalid-input-constraints", message: "must be an object" });
        else {
          hasOnlyKeys(constraints, ["required", "minLength", "maxLength", "pattern"], `/elements/${id}/inputConstraints`, issues);
          if (constraints.required !== undefined && typeof constraints.required !== "boolean") issues.push({ path: `/elements/${id}/inputConstraints/required`, code: "invalid-input-constraint", message: "must be a boolean" });
          for (const key of ["minLength", "maxLength"] as const) if (constraints[key] !== undefined && (!Number.isSafeInteger(constraints[key]) || Number(constraints[key]) < 0)) issues.push({ path: `/elements/${id}/inputConstraints/${key}`, code: "invalid-input-constraint", message: "must be a non-negative integer" });
          if (typeof constraints.pattern === "string") { try { new RegExp(constraints.pattern); } catch { issues.push({ path: `/elements/${id}/inputConstraints/pattern`, code: "invalid-input-constraint", message: "must be a valid pattern" }); } }
          else if (constraints.pattern !== undefined) issues.push({ path: `/elements/${id}/inputConstraints/pattern`, code: "invalid-input-constraint", message: "must be a string" });
          if (typeof constraints.minLength === "number" && typeof constraints.maxLength === "number" && constraints.minLength > constraints.maxLength) issues.push({ path: `/elements/${id}/inputConstraints`, code: "invalid-input-constraints", message: "minLength cannot exceed maxLength" });
        }
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: raw as unknown as UiModelDocument };
}

export function validateScenarioAgainstModel(scenario: ScenarioDocument, model: UiModelDocument): ValidationResult<ScenarioDocument> {
  const issues: ValidationIssue[] = [];
  if (scenario.start_page !== model.page.id) {
    issues.push({ path: "/start_page", code: "unknown-page", message: `does not match model page ${model.page.id}` });
  }
  for (const [index, step] of scenario.steps.entries()) {
    if (step.page !== model.page.id) {
      issues.push({ path: `/steps/${index}/page`, code: "unknown-page", message: `does not match model page ${model.page.id}` });
    }
    const target = "target" in step ? step.target : step.assert.target;
    if (!(target in model.elements)) {
      issues.push({ path: `/steps/${index}`, code: "unresolved-target", message: `target ${target} does not exist in the model` });
    }
  }
  return issues.length === 0 ? { ok: true, value: scenario } : { ok: false, issues };
}
