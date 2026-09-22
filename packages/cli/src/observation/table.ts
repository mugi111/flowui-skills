import type { Page } from "playwright";

import { redactValue, type RedactionPolicy } from "../shared/redaction.js";

export interface TableInspectOptions {
  readonly rowLimit?: number;
  readonly columns?: readonly string[];
  readonly where?: Readonly<Record<string, string>>;
  readonly matchingOnly?: boolean;
  readonly metadataOnly?: boolean;
  readonly redactionPolicy?: RedactionPolicy;
}

export interface TableObservation {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
  readonly renderedRowCount: number;
  readonly completeness: "complete" | "partial";
  readonly omissions: readonly string[];
  readonly scope: "rendered-rows-only";
}

export async function inspectTable(page: Page, tableSelector: string, options: TableInspectOptions = {}): Promise<TableObservation> {
  const rowLimit = options.rowLimit ?? 20;
  if (!Number.isSafeInteger(rowLimit) || rowLimit < 1) throw new Error("rowLimit must be a positive safe integer");
  const raw = await page.locator(tableSelector).evaluate((node) => {
    if (!(node instanceof HTMLTableElement)) throw new Error("target is not a table element");
    const headerCells = [...node.querySelectorAll("thead th")];
    const firstRowHeaderCells = [...node.querySelectorAll("tr:first-child th")];
    const headers = (headerCells.length > 0 ? headerCells : firstRowHeaderCells).map((cell, index) => cell.textContent?.trim() || `column-${index + 1}`);
    const rows = [...node.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td, th")].map((cell) => cell.textContent?.trim() ?? ""));
    return { headers, rows };
  });
  if (raw.headers.length === 0) throw new Error("table has no observable column headers");
  if (new Set(raw.headers).size !== raw.headers.length) throw new Error("table has duplicate observable column headers");

  const requestedColumns = options.columns ?? raw.headers;
  const unknownColumns = requestedColumns.filter((column) => !raw.headers.includes(column));
  if (unknownColumns.length > 0) throw new Error(`unknown table columns: ${unknownColumns.join(", ")}`);
  const filters = options.where ?? {};
  const unknownFilterColumns = Object.keys(filters).filter((column) => !raw.headers.includes(column));
  if (unknownFilterColumns.length > 0) throw new Error(`unknown filter columns: ${unknownFilterColumns.join(", ")}`);

  const allRows = raw.rows.map((cells) => Object.fromEntries(raw.headers.map((header, index) => [header, cells[index] ?? ""])));
  const matchingRows = allRows.filter((row) => Object.entries(filters).every(([column, expected]) => row[column] === expected));
  const sourceRows = options.matchingOnly ? matchingRows : allRows;
  const rows = options.metadataOnly
    ? []
    : sourceRows.slice(0, rowLimit).map((row) => redactValue(Object.fromEntries(requestedColumns.map((column) => [column, row[column]])), options.redactionPolicy) as Readonly<Record<string, string>>);
  const omissions: string[] = [];
  if (!options.metadataOnly && sourceRows.length > rowLimit) omissions.push(`${sourceRows.length - rowLimit} rendered rows omitted by rowLimit`);
  omissions.push("only rows currently rendered by the browser are observed");
  return {
    columns: requestedColumns,
    rows,
    renderedRowCount: raw.rows.length,
    completeness: omissions.length === 1 ? "complete" : "partial",
    omissions,
    scope: "rendered-rows-only",
  };
}
