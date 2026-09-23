export type ActionRisk = "read-only" | "mutation" | "destructive" | "unknown";

export interface ActionDefinition {
  readonly id: string;
  readonly risk: ActionRisk;
  readonly targetScope: string;
  readonly binding?: string;
}

export interface Permit {
  readonly scenarioHash: string;
  readonly modelHash: string;
  readonly environment: string;
  readonly origin?: string;
  readonly actionIds: readonly string[];
  readonly targetScopes: readonly string[];
  readonly actionBindings?: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

export type GateResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "unknown-action" | "permit-required" | "permit-expired" | "permit-mismatch" };

export function evaluateGate(action: ActionDefinition, permit: Permit | undefined, context: { readonly scenarioHash: string; readonly modelHash: string; readonly environment: string; readonly origin?: string; readonly now: Date }): GateResult {
  if (action.risk === "unknown") return { allowed: false, reason: "unknown-action" };
  if (action.risk === "read-only") return { allowed: true };
  if (permit === undefined) return { allowed: false, reason: "permit-required" };
  if (!Number.isFinite(context.now.getTime())) return { allowed: false, reason: "permit-expired" };
  const expiresAt = Date.parse(permit.expiresAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(permit.expiresAt) || !Number.isFinite(expiresAt) || expiresAt <= context.now.getTime()) return { allowed: false, reason: "permit-expired" };
  if (permit.scenarioHash !== context.scenarioHash || permit.modelHash !== context.modelHash || permit.environment !== context.environment || permit.origin !== context.origin || !permit.actionIds.includes(action.id) || !permit.targetScopes.includes(action.targetScope) || (action.binding !== undefined && permit.actionBindings?.[action.id] !== action.binding)) {
    return { allowed: false, reason: "permit-mismatch" };
  }
  return { allowed: true };
}
