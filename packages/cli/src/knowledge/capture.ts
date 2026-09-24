import type { UiModelDocument } from "../contracts/types.js";
import type { PageObservation } from "../observation/observe.js";

export interface PageDefinition {
  readonly id: string;
  readonly urlPattern?: RegExp;
  readonly landmarks: readonly { readonly role: "heading"; readonly name: string }[];
}

export type PageIdentityResult =
  | { readonly kind: "identified"; readonly page: PageDefinition }
  | { readonly kind: "unknown" }
  | { readonly kind: "ambiguous"; readonly candidateIds: readonly string[] };

export interface CaptureCandidate {
  readonly pageIdentity: PageIdentityResult;
  readonly model?: Omit<UiModelDocument, "revision">;
  readonly requiresAcceptance: true;
}

export function identifyPage(observation: PageObservation, definitions: readonly PageDefinition[]): PageIdentityResult {
  const matched = definitions.filter((definition) => {
    if (definition.urlPattern !== undefined) {
      definition.urlPattern.lastIndex = 0;
      if (!definition.urlPattern.test(observation.url)) return false;
    }
    return definition.landmarks.every((landmark) => observation.headings.some((heading) => landmark.role === "heading" && heading.text === landmark.name));
  });
  if (matched.length === 0) return { kind: "unknown" };
  if (matched.length > 1) return { kind: "ambiguous", candidateIds: matched.map((definition) => definition.id).sort() };
  return { kind: "identified", page: matched[0]! };
}

export function createCaptureCandidate(observation: PageObservation, definitions: readonly PageDefinition[]): CaptureCandidate {
  const pageIdentity = identifyPage(observation, definitions);
  if (pageIdentity.kind !== "identified") return { pageIdentity, requiresAcceptance: true };

  const elements: Record<string, { state: "observed"; role: string; name: string; inputType?: string; autocomplete?: string; inputConstraints?: import("../contracts/types.js").InputConstraints; targetAliases?: readonly string[] }> = {};
  for (const [index, element] of observation.elements.entries()) {
    const key = logicalElementId(element.role, element.name, index);
    elements[key] = { state: "observed", role: element.role, name: element.name, ...(element.inputType === undefined ? {} : { inputType: element.inputType }), ...(element.autocomplete === undefined ? {} : { autocomplete: element.autocomplete }), ...(element.inputConstraints === undefined ? {} : { inputConstraints: element.inputConstraints }), ...(element.targetAliases === undefined ? {} : { targetAliases: element.targetAliases }) };
  }
  return {
    pageIdentity,
    requiresAcceptance: true,
    model: {
      schema_version: "1.0",
      page: {
        id: pageIdentity.page.id,
        name: pageIdentity.page.landmarks[0]?.name ?? pageIdentity.page.id,
        identity: { landmarks: pageIdentity.page.landmarks },
      },
      elements,
    },
  };
}

function logicalElementId(role: string, name: string, index: number): string {
  const normalized = `${role}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.length > 0 ? `${normalized}-${index + 1}` : `element-${index + 1}`;
}
