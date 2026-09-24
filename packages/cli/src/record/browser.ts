import type { BrowserContext, Frame, Page } from "playwright";
import { redactUrl, type RedactionPolicy } from "../shared/redaction.js";
import { RecordCollector } from "./collector.js";

export interface BrowserRecordOptions extends RedactionPolicy {
  readonly secretReferences?: Readonly<Record<string, string>>;
  readonly targetAliases?: Readonly<Record<string, string>>;
}

/** Installs page-side redaction so raw sensitive values are never passed to the host binding. */
export async function subscribeBrowserRecord(context: BrowserContext, collector: RecordCollector, options: BrowserRecordOptions = {}): Promise<() => void> {
  const bindingName = `__flowui_record_${crypto.randomUUID().replaceAll("-", "")}`;
  const documentId = crypto.randomUUID();
  const configuredKeys = [...(options.sensitiveKeys ?? []), ...(options.sensitiveFields ?? [])].map((key) => key.toLowerCase());
  const secretReferences = options.secretReferences ?? {};
  const targetAliases = options.targetAliases ?? {};
  const disposeBinding = await context.exposeBinding(bindingName, (_source, raw: unknown) => {
    if (!raw || typeof raw !== "object") { collector.add(raw as never); return; }
    collector.add(raw as never);
  });
  const installer = ({ binding, configuredKeys, secretReferences, targetAliases, documentId }: { binding: string; configuredKeys: string[]; secretReferences: Record<string, string>; targetAliases: Record<string, string>; documentId: string }) => {
    const bindingFunction = (window as unknown as Record<string, (event: unknown) => Promise<void>>)[binding];
    if (typeof bindingFunction !== "function") return;
    const lower = (value: string) => value.trim().toLowerCase();
    const isSensitive = (field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, label: string, targetId: string) => {
      const auto = lower(field.getAttribute("autocomplete") ?? "");
      if ((field instanceof HTMLInputElement && field.type.toLowerCase() === "password") || /password|one-time-code|cc-|credit-card|transaction-/i.test(auto)) return true;
      const keys = [targetId, field.id, (field as HTMLInputElement).name ?? "", label];
      return keys.some((key) => /password|passphrase|secret|token|api[_-]?key/i.test(key) || configuredKeys.includes(lower(key)));
    };
    const labelOf = (field: Element) => {
      const labelled = field.getAttribute("aria-label") ?? "";
      const associated = "labels" in field ? Array.from((field as HTMLInputElement).labels ?? []).map((label) => label.innerText).join(" ") : "";
      return `${labelled} ${associated}`.trim();
    };
    const targetOf = (field: Element) => field.getAttribute("data-flowui-target") || field.id || ((field as HTMLInputElement).name ?? "");
    const onInput = (event: Event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
      const rawTarget = targetOf(field);
      const label = labelOf(field);
      const aliases = [rawTarget, field.id, (field as HTMLInputElement).name ?? "", field.getAttribute("data-testid") ?? "", field.getAttribute("aria-label") ?? "", label].filter(Boolean);
      const resolvedTargets = [...new Set(aliases.map((alias) => targetAliases[alias]).filter((targetId): targetId is string => Boolean(targetId)))];
      const logicalTarget = field.getAttribute("data-flowui-target") || (resolvedTargets.length === 1 ? resolvedTargets[0] : undefined);
      const target = logicalTarget ?? rawTarget;
      const inputType = field instanceof HTMLInputElement ? field.type.toLowerCase() : field instanceof HTMLTextAreaElement ? "textarea" : "select";
      const value = field.value;
      const masked = /^\s*[•●*xX]{3,}\s*$/.test(value);
      const secretRef = secretReferences[target] ?? secretReferences[rawTarget] ?? secretReferences[field.name] ?? secretReferences[field.id];
      const sensitive = isSensitive(field, label, target) || Boolean(secretRef);
      const knownType = ["text", "search", "email", "tel", "url", "number", "checkbox", "radio", "date", "datetime-local", "month", "week", "time", "color", "range", "textarea", "select"].includes(inputType);
      const knownTarget = Boolean(target || field.getAttribute("name") || label);
      const valueRecord = masked ? { kind: "redacted" } : sensitive ? secretRef ? { kind: "secret", ref: secretRef } : { kind: "redacted" } : knownType && knownTarget ? { kind: "literal", value } : { kind: "redacted" };
      void bindingFunction({ documentId, type: "input", target: target || "unknown", input: { inputType, autocomplete: field.getAttribute("autocomplete") ?? undefined, targetId: target || undefined, name: field.getAttribute("name") ?? undefined, label: label || undefined }, value: valueRecord });
    };
    const onClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest("button,a,[role=button],input[type=button],input[type=submit]") : null;
      if (!target) return;
      const id = target.getAttribute("data-flowui-target") || target.id || target.getAttribute("name") || "unknown";
      void bindingFunction({ documentId, type: "click", target: id });
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("click", onClick, true);
    (window as unknown as Record<string, () => void>)[`${binding}_cleanup`] = () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      document.removeEventListener("click", onClick, true);
    };
  };
  const installerOptions = { binding: bindingName, configuredKeys, secretReferences: { ...secretReferences }, targetAliases: { ...targetAliases }, documentId };
  const disposeScript = await context.addInitScript(installer, installerOptions);
  await Promise.all(context.pages().map((page) => page.evaluate(installer, installerOptions)));
  const navigations = new Map<Page, (frame: Frame) => void>();
  const onPage = (page: Page) => {
    if (navigations.has(page)) return;
    const listener = (frame: Frame) => {
      if (page.mainFrame() !== frame) return;
      collector.add({ documentId: crypto.randomUUID(), type: "navigation", target: redactUrl(page.url(), options) });
    };
    navigations.set(page, listener);
    page.on("framenavigated", listener);
  };
  for (const page of context.pages()) onPage(page);
  context.on("page", onPage);
  return () => {
    context.off("page", onPage);
    for (const [page, listener] of navigations) page.off("framenavigated", listener);
    navigations.clear();
    for (const page of context.pages()) void page.evaluate((binding) => {
      const scope = window as unknown as Record<string, unknown>;
      const cleanup = scope[`${binding}_cleanup`];
      if (typeof cleanup === "function") (cleanup as () => void)();
      delete scope[`${binding}_cleanup`];
    }, bindingName);
    void disposeScript.dispose();
    void disposeBinding.dispose();
  };
}
