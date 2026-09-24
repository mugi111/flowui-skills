import { classifySensitivity, type RedactionPolicy, type SensitivityContext } from "../shared/redaction.js";

export type RecordedValue = { readonly kind: "literal"; readonly value: string } | { readonly kind: "secret"; readonly ref: string } | { readonly kind: "redacted" };
export interface RecordedEvent { readonly sequence:number; readonly documentId:string; readonly type:"click"|"input"|"navigation"; readonly target:string; readonly value?:RecordedValue; }
export interface IncomingRecordEvent extends Omit<RecordedEvent, "sequence" | "value"> {
  readonly value?: unknown;
  readonly input?: SensitivityContext;
}

export class RecordCollector {
  private events: RecordedEvent[] = [];
  private stopped = false;
  constructor(private readonly policy: RedactionPolicy = {}) {}
  add(event: IncomingRecordEvent): void {
    if (this.stopped) throw new Error("recording is stopped");
    if (!event || typeof event.documentId !== "string" || event.documentId.length === 0 || typeof event.target !== "string" || event.target.length === 0 || !["click", "input", "navigation"].includes(event.type)) {
      this.invalidate("invalid recording event; recording stopped");
    }
    if (event.input !== undefined && (!event.input || typeof event.input !== "object" || Object.values(event.input).some((value) => value !== undefined && typeof value !== "string"))) {
      this.invalidate("invalid event metadata; recording stopped");
    }
    if (event.type !== "input" && event.value !== undefined) {
      this.invalidate("unexpected event value; recording stopped");
    }
    let value: RecordedValue | undefined;
    if (event.type === "input") {
      if (!isRecordedValue(event.value)) this.invalidate("invalid input event; recording stopped");
      const sensitivity = classifySensitivity({ ...event.input, targetId: event.input?.targetId ?? event.target }, this.policy);
      const candidate = event.value;
      const masked = candidate.kind === "literal" && /^\s*[•●*xX]{3,}\s*$/.test(candidate.value);
      value = candidate.kind === "redacted" || masked || sensitivity === "unknown"
        ? { kind: "redacted" }
        : candidate.kind === "secret"
          ? sensitivity === "sensitive" ? candidate : { kind: "redacted" }
          : sensitivity === "public" ? candidate : { kind: "redacted" };
    }
    this.events.push({ sequence: this.events.length + 1, documentId: event.documentId, type: event.type, target: event.target, ...(value === undefined ? {} : { value }) });
  }
  stop(): readonly RecordedEvent[] { this.stopped = true; return this.events; }
  private invalidate(message: string): never { this.stopped = true; this.events = []; throw new Error(message); }
}

function isRecordedValue(value: unknown): value is RecordedValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "literal") return Object.keys(record).length === 2 && typeof record.value === "string";
  if (record.kind === "secret") return Object.keys(record).length === 2 && typeof record.ref === "string" && record.ref.length > 0;
  return record.kind === "redacted" && Object.keys(record).length === 1;
}
