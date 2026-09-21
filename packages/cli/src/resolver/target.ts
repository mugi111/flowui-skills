import type { UiModelDocument } from "../contracts/types.js";

export interface ObservedTarget {
  readonly logicalId?: string;
  readonly role: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locator: string;
}

export type TargetResolution =
  | { readonly kind: "resolved"; readonly target: ObservedTarget }
  | { readonly kind: "not-found"; readonly logicalId: string }
  | { readonly kind: "ambiguous"; readonly logicalId: string; readonly candidates: readonly ObservedTarget[] };

export function resolveTarget(model: UiModelDocument, logicalId: string, observed: readonly ObservedTarget[]): TargetResolution {
  const definition = model.elements[logicalId];
  if (definition === undefined) return { kind: "not-found", logicalId };
  const candidates = observed.filter(
    (target) => target.visible && ((target.logicalId === logicalId) || (target.role === definition.role && target.name === definition.name)),
  );
  if (candidates.length === 0) return { kind: "not-found", logicalId };
  if (candidates.length > 1) return { kind: "ambiguous", logicalId, candidates };
  return { kind: "resolved", target: candidates[0]! };
}

export interface TableRow {
  readonly index: number;
  readonly cells: Readonly<Record<string, string>>;
}

export type RowResolution =
  | { readonly kind: "resolved"; readonly row: TableRow }
  | { readonly kind: "not-found" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly TableRow[] };

export function resolveTableRow(rows: readonly TableRow[], match: Readonly<Record<string, string>>): RowResolution {
  const candidates = rows.filter((row) => Object.entries(match).every(([column, expected]) => row.cells[column] === expected));
  if (candidates.length === 0) return { kind: "not-found" };
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  return { kind: "resolved", row: candidates[0]! };
}
