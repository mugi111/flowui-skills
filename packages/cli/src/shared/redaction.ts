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
  readonly sensitiveQueryParameters?: readonly string[];
  readonly replacement?: string;
}

export interface RedactedText {
  readonly text: string;
  readonly truncated: boolean;
  readonly omittedCharacters: number;
}

function normalizedSensitiveKeys(policy: RedactionPolicy): Set<string> {
  return new Set([...defaultSensitiveKeys, ...(policy.sensitiveKeys ?? [])].map((key) => key.toLowerCase()));
}

function replacement(policy: RedactionPolicy): string {
  return policy.replacement ?? "[REDACTED]";
}

export function redactUrl(rawUrl: string, policy: RedactionPolicy = {}): string {
  try {
    const url = new URL(rawUrl);
    const sensitiveParameters = new Set([...(policy.sensitiveQueryParameters ?? []), ...defaultSensitiveKeys].map((key) => key.toLowerCase()));
    for (const [key] of url.searchParams) {
      if (sensitiveParameters.has(key.toLowerCase())) url.searchParams.set(key, replacement(policy));
    }
    return url.toString();
  } catch {
    return rawUrl;
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
      sensitiveKeys.has(key.toLowerCase()) ? redact : redactValue(child, policy),
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
