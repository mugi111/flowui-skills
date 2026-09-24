const defaultSensitiveKeys = new Set([
  "password",
  "passphrase",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "set-cookie",
  "api_key",
  "apikey",
]);

export interface RedactionPolicy {
  readonly sensitiveKeys?: readonly string[];
  readonly sensitiveFields?: readonly string[];
  readonly sensitiveQueryParameters?: readonly string[];
  readonly replacement?: string;
}

export interface RedactedText {
  readonly text: string;
  readonly truncated: boolean;
  readonly omittedCharacters: number;
}

function normalizedSensitiveKeys(policy: RedactionPolicy): Set<string> {
  return new Set([...defaultSensitiveKeys, ...(policy.sensitiveKeys ?? []), ...(policy.sensitiveFields ?? [])].map((key) => key.trim().toLowerCase()));
}

function isSensitiveKey(key: string, configured: ReadonlySet<string>): boolean {
  return configured.has(key.trim().toLowerCase()) || /password|passphrase|secret|token|authorization|cookie|api[_-]?key/i.test(key);
}

export type Sensitivity = "public" | "sensitive" | "unknown";
export interface SensitivityContext {
  readonly inputType?: string;
  readonly autocomplete?: string;
  readonly targetId?: string;
  readonly name?: string;
  readonly label?: string;
}

export function classifySensitivity(context: SensitivityContext, policy: RedactionPolicy = {}): Sensitivity {
  const sensitive = normalizedSensitiveKeys(policy);
  const identifiers = [context.targetId, context.name, context.label].filter((item): item is string => typeof item === "string");
  if (context.inputType?.toLowerCase() === "password" || /password|one-time-code|cc-|credit-card|transaction-/i.test(context.autocomplete ?? "")) return "sensitive";
  if (identifiers.some((value) => isSensitiveKey(value, sensitive))) return "sensitive";
  if (context.inputType !== undefined && !["text", "search", "email", "tel", "url", "number", "checkbox", "radio", "date", "textarea", "select"].includes(context.inputType.toLowerCase())) return "unknown";
  return context.inputType !== undefined || context.name !== undefined || context.label !== undefined ? "public" : "unknown";
}

function replacement(policy: RedactionPolicy): string {
  return policy.replacement ?? "[REDACTED]";
}

export function redactUrl(rawUrl: string, policy: RedactionPolicy = {}): string {
  try {
    const url = new URL(rawUrl);
    const sensitiveParameters = normalizedSensitiveKeys({ ...policy, sensitiveKeys: [...(policy.sensitiveKeys ?? []), ...(policy.sensitiveFields ?? []), ...(policy.sensitiveQueryParameters ?? [])] });
    for (const [key] of url.searchParams) {
      if (isSensitiveKey(key, sensitiveParameters)) url.searchParams.set(key, replacement(policy));
    }
    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}

export function redactValue(value: unknown, policy: RedactionPolicy = {}): unknown {
  const sensitiveKeys = normalizedSensitiveKeys(policy);
  const redact = replacement(policy);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, policy));
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      isSensitiveKey(key, sensitiveKeys) ? redact : redactValue(child, policy),
    ]),
  );
}

export function redactLog(value: unknown, policy: RedactionPolicy = {}): string {
  return JSON.stringify(redactValue(value, policy));
}

export function limitText(text: string, maximumBytes: number): RedactedText {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error("maximumBytes must be a non-negative safe integer");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maximumBytes) return { text, truncated: false, omittedCharacters: 0 };

  let end = 0;
  let usedBytes = 0;
  for (const codePoint of text) {
    const codePointBytes = new TextEncoder().encode(codePoint).length;
    if (usedBytes + codePointBytes > maximumBytes) break;
    usedBytes += codePointBytes;
    end += codePoint.length;
  }
  return { text: text.slice(0, end), truncated: true, omittedCharacters: text.length - end };
}
