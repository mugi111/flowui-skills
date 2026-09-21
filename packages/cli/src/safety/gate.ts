export type ActionRisk = "read-only" | "mutation" | "destructive" | "unknown";

export interface ActionDefinition {
  readonly id: string;
  readonly risk: ActionRisk;
  readonly targetScope: string;
}

export interface Permit {
  readonly scenarioHash: string;
  readonly modelHash: string;
  readonly environment: string;
  readonly actionIds: readonly string[];
  readonly targetScopes: readonly string[];
  readonly expiresAt: string;
}

export type GateResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "unknown-action" | "permit-required" | "permit-expired" | "permit-mismatch" };

export function evaluateGate(action: ActionDefinition, permit: Permit | undefined, context: { readonly scenarioHash: string; readonly modelHash: string; readonly environment: string; readonly now: Date }): GateResult {
  if (action.risk === "unknown") return { allowed: false, reason: "unknown-action" };
  if (action.risk === "read-only") return { allowed: true };
  if (permit === undefined) return { allowed: false, reason: "permit-required" };
  if (Date.parse(permit.expiresAt) <= context.now.getTime()) return { allowed: false, reason: "permit-expired" };
  if (permit.scenarioHash !== context.scenarioHash || permit.modelHash !== context.modelHash || permit.environment !== context.environment || !permit.actionIds.includes(action.id) || !permit.targetScopes.includes(action.targetScope)) {
    return { allowed: false, reason: "permit-mismatch" };
  }
  return { allowed: true };
}
