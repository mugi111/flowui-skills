export const schemaVersion = "1.0" as const;

export type SchemaVersion = typeof schemaVersion;
export type KnowledgeState = "observed" | "unknown";
export type ScenarioStatus = "draft" | "ready";
export type ActionName = "click" | "fill" | "select" | "check" | "uncheck" | "press" | "navigate";
export type AssertionType =
  | "visible"
  | "hidden"
  | "enabled"
  | "disabled"
  | "text"
  | "value"
  | "url"
  | "page"
  | "state"
  | "row-count";

export interface SecretReference {
  readonly secret: string;
}

export interface InputReference {
  readonly input: string;
}

export type StepValue = string | number | boolean | SecretReference | InputReference;

export interface ActionStep {
  readonly id: string;
  readonly page: string;
  readonly action: ActionName;
  readonly target: string;
  readonly value?: StepValue;
}

export interface AssertionStep {
  readonly id: string;
  readonly page: string;
  readonly assert: {
    readonly type: AssertionType;
    readonly target: string;
    readonly equals?: string | number | boolean;
  };
  readonly expectation: {
    readonly source: "user-intent";
    readonly reference: string;
  };
}

export type ScenarioStep = ActionStep | AssertionStep;

export interface ScenarioDocument {
  readonly schema_version: SchemaVersion;
  readonly id: string;
  readonly status: ScenarioStatus;
  readonly intent: string;
  readonly start_page: string;
  readonly inputs?: Readonly<Record<string, { readonly type: "string" | "number" | "boolean"; readonly sensitive: boolean }>>;
  readonly steps: readonly ScenarioStep[];
}

export interface UiModelDocument {
  readonly schema_version: SchemaVersion;
  readonly page: {
    readonly id: string;
    readonly name: string;
    readonly identity: {
      readonly landmarks: readonly { readonly role: string; readonly name: string }[];
    };
  };
  readonly revision: string;
  readonly elements: Readonly<Record<string, { readonly state: KnowledgeState; readonly role: string; readonly name: string; readonly inputType?: string; readonly autocomplete?: string; readonly inputConstraints?: InputConstraints; readonly targetAliases?: readonly string[] }>>;
}

export interface InputConstraints {
  readonly required?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
