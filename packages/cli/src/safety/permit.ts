import type { ActionStep, ScenarioDocument, UiModelDocument } from "../contracts/types.js";
import { contentHash } from "../knowledge/store.js";
import type { Permit } from "./gate.js";

export function createPermit(scenario: ScenarioDocument, models: Readonly<Record<string, UiModelDocument>>, options: { readonly origin: string; readonly environment: string; readonly expiresAt: string; readonly stepIds: readonly string[] }): Permit {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("origin must be a bare HTTP(S) origin");
  if (origin.protocol !== "http:" && origin.protocol !== "https:") throw new Error("origin must use HTTP or HTTPS");
  const expiry = Date.parse(options.expiresAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(options.expiresAt) || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("expiresAt must be a future UTC timestamp");
  const chosen = new Set(options.stepIds);
  if (chosen.size === 0 || chosen.size !== options.stepIds.length) throw new Error("permit needs unique Step IDs");
  const steps = scenario.steps.filter((step): step is ActionStep => "action" in step && chosen.has(step.id));
  if (steps.length !== chosen.size) throw new Error("permit references an unknown or non-action Step");
  for (const step of steps) if (!models[step.page]?.elements[step.target]) throw new Error(`permit target is absent from the Model: ${step.target}`);
  const modelHash = contentHash(Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b))));
  const actionBindings = Object.fromEntries(steps.map((step) => {
    let navigationDestination: string | null = null;
    if (step.action === "navigate") {
      if (typeof step.value !== "string") throw new Error("Permit creation requires a literal destination for navigation");
      const destination = new URL(step.value, origin.origin);
      if (destination.origin !== origin.origin || destination.username || destination.password) throw new Error("navigation Permit cannot leave its bound origin");
      navigationDestination = destination.toString();
    }
    return [step.id, contentHash({ targetId: step.target, targetScope: step.target, inputConstraints: models[step.page]!.elements[step.target]!.inputConstraints ?? null, navigationDestination })];
  }));
  return {
    scenarioHash: contentHash(scenario), modelHash, environment: options.environment, origin: origin.origin,
    actionIds: steps.map((step) => step.id), targetScopes: steps.map((step) => step.target), actionBindings, expiresAt: options.expiresAt,
  };
}
