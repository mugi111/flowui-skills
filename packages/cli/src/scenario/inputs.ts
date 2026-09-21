import type { ScenarioDocument, StepValue } from "../contracts/types.js";

export type InputResolution =
  | { readonly ok: true; readonly value: string | number | boolean }
  | { readonly ok: false; readonly reason: "missing-input" | "missing-secret" | "invalid-reference" };

export function resolveStepValue(value: StepValue | undefined, inputs: Readonly<Record<string, string | number | boolean>>, secrets: Readonly<Record<string, string>>): InputResolution {
  if (value === undefined) return { ok: false, reason: "invalid-reference" };
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return { ok: true, value };
  if ("input" in value) return value.input in inputs ? { ok: true, value: inputs[value.input]! } : { ok: false, reason: "missing-input" };
  if ("secret" in value) return value.secret in secrets ? { ok: true, value: secrets[value.secret]! } : { ok: false, reason: "missing-secret" };
  return { ok: false, reason: "invalid-reference" };
}

export function validateRunInputs(scenario: ScenarioDocument, inputs: Readonly<Record<string, string | number | boolean>>, secrets: Readonly<Record<string, string>>): readonly string[] {
  const missing: string[] = [];
  for (const step of scenario.steps) {
    if (!("action" in step) || step.value === undefined) continue;
    const resolution = resolveStepValue(step.value, inputs, secrets);
    if (!resolution.ok) missing.push(`${step.id}:${resolution.reason}`);
  }
  return missing;
}
