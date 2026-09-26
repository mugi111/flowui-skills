import { join } from "node:path";
import { loadDocument } from "../contracts/document.js";
import type { RedactionPolicy } from "../shared/redaction.js";

export interface ProjectSafetyConfig extends RedactionPolicy {
  readonly secretReferences: Readonly<Record<string, string>>;
}

export function resolveEnvironmentSecrets(
  references: readonly string[],
  configured: Readonly<Record<string, string>>,
  read: (name: string) => string | undefined,
): Readonly<Record<string, string | undefined>> {
  const secrets: Record<string, string | undefined> = {};
  for (const reference of references) {
    const configuredReference = configured[reference];
    const environmentName = reference.startsWith("env:") ? reference.slice(4) : configuredReference?.slice(4);
    secrets[reference] = environmentName ? read(environmentName) : undefined;
  }
  return secrets;
}

export async function loadProjectSafetyConfig(projectDirectory: string): Promise<ProjectSafetyConfig> {
  const configPath = join(projectDirectory, ".flowui", "config.json");
  let raw: unknown;
  try {
    raw = await loadDocument(configPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { secretReferences: {} };
    throw new Error("invalid .flowui/config.json");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid .flowui/config.json");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["sensitive_fields", "secret_references"].includes(key))) throw new Error("unknown .flowui/config.json setting");
  if (value.sensitive_fields !== undefined && (!Array.isArray(value.sensitive_fields) || value.sensitive_fields.some((key) => typeof key !== "string"))) throw new Error("invalid sensitive_fields setting");
  const rawReferences = value.secret_references;
  if (rawReferences !== undefined && (!rawReferences || typeof rawReferences !== "object" || Array.isArray(rawReferences))) throw new Error("invalid secret_references setting");
  const secretReferences = (rawReferences ?? {}) as Record<string, unknown>;
  for (const [name, reference] of Object.entries(secretReferences)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name) || typeof reference !== "string" || !/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) {
      throw new Error("secret_references must map names to env:VARIABLE references");
    }
  }
  const normalizedReferences = secretReferences as Record<string, string>;
  const sensitiveFields = [...(value.sensitive_fields as string[] | undefined ?? []), ...Object.keys(normalizedReferences)];
  return { ...(sensitiveFields.length === 0 ? {} : { sensitiveFields }), secretReferences: normalizedReferences };
}
