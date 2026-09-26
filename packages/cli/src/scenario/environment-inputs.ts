import type { ScenarioDocument } from "../contracts/types.js";

export type EnvironmentValueReader = (name: string) => string | undefined;

/** Reads declared Scenario inputs from environment variables and converts them to their declared types. */
export function resolveEnvironmentInputs(
  definitions: ScenarioDocument["inputs"],
  read: EnvironmentValueReader,
  prefix = "FLOWUI_INPUT_",
): Readonly<Record<string, string | number | boolean>> {
  const resolved: Record<string, string | number | boolean> = {};
  for (const [id, definition] of Object.entries(definitions ?? {})) {
    if (definition.sensitive) continue;
    const environmentName = `${prefix}${id.replace(/-/g, "_").toUpperCase()}`;
    const raw = read(environmentName);
    if (raw === undefined) continue;
    if (definition.type === "string") {
      resolved[id] = raw;
    } else if (definition.type === "boolean") {
      if (raw !== "true" && raw !== "false") throw new Error(`invalid boolean environment input: ${id}`);
      resolved[id] = raw === "true";
    } else {
      const value = raw.trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new Error(`invalid number environment input: ${id}`);
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`invalid number environment input: ${id}`);
      resolved[id] = number;
    }
  }
  return resolved;
}
