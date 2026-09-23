import type { Page } from "playwright";

import { limitText, redactUrl, type RedactionPolicy } from "../shared/redaction.js";

export interface ObservationElement {
  readonly id: string;
  readonly role: string;
  readonly name: string;
  readonly inputType?: string;
  readonly autocomplete?: string;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly locatorCandidates: readonly string[];
}

export interface PageObservation {
  readonly url: string;
  readonly headings: readonly { readonly level: number; readonly text: string }[];
  readonly elements: readonly ObservationElement[];
  readonly completeness: "complete" | "partial";
  readonly omissions: readonly string[];
}

export interface ObserveOptions {
  readonly elementLimit?: number;
  readonly textLimit?: number;
  readonly redactionPolicy?: RedactionPolicy;
}

const interactiveSelector = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=checkbox]",
  "[role=switch]",
].join(",");

export async function observePage(page: Page, options: ObserveOptions = {}): Promise<PageObservation> {
  const elementLimit = options.elementLimit ?? 200;
  const textLimit = options.textLimit ?? 200;
  if (!Number.isSafeInteger(elementLimit) || elementLimit < 1) throw new Error("elementLimit must be a positive safe integer");
  if (!Number.isSafeInteger(textLimit) || textLimit < 1) throw new Error("textLimit must be a positive safe integer");

  const [headings, collected] = await Promise.all([
    page.locator("h1, h2, h3, h4, h5, h6, [role=heading]").evaluateAll((nodes) =>
      nodes.map((node) => {
        const element = node as HTMLElement;
        const ariaLevel = element.getAttribute("aria-level");
        const headingLevel = /^H([1-6])$/.exec(element.tagName)?.[1];
        return { level: Number(ariaLevel ?? headingLevel ?? 0), text: element.innerText.trim() };
      }),
    ),
    page.locator(interactiveSelector).evaluateAll((nodes, limit) => {
      const isVisible = (element: HTMLElement): boolean => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && element.getClientRects().length > 0;
      };
      const inferRole = (element: HTMLElement): string => {
        const explicit = element.getAttribute("role");
        if (explicit !== null) return explicit;
        if (element.tagName === "A") return "link";
        if (element.tagName === "BUTTON") return "button";
        if (element.tagName === "SELECT") return "combobox";
        if (element.tagName === "TEXTAREA") return "textbox";
        const input = element as HTMLInputElement;
        if (element.tagName === "INPUT" && (input.type === "checkbox" || input.type === "radio")) return input.type;
        return "textbox";
      };
      const nameFor = (element: HTMLElement): string => {
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy !== null) {
          const labels = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean);
          if (labels.length > 0) return labels.join(" ");
        }
        return element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.innerText.trim() ?? "";
      };
      const candidates = (element: HTMLElement): string[] => {
        const values: string[] = [];
        if (element.id) values.push(`#${CSS.escape(element.id)}`);
        const testId = element.getAttribute("data-testid");
        if (testId) values.push(`[data-testid=${JSON.stringify(testId)}]`);
        const name = element.getAttribute("name");
        if (name) values.push(`[name=${JSON.stringify(name)}]`);
        const label = element.getAttribute("aria-label");
        if (label) values.push(`[aria-label=${JSON.stringify(label)}]`);
        return values;
      };
      return {
        total: nodes.length,
        items: nodes.slice(0, limit).map((node, index) => {
          const element = node as HTMLElement;
          const control = element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement;
          return {
            id: `observed-${index + 1}`,
            role: inferRole(element),
            name: nameFor(element),
            ...(element.tagName === "INPUT" ? { inputType: (element as HTMLInputElement).type.toLowerCase() } : element.tagName === "TEXTAREA" ? { inputType: "textarea" } : element.tagName === "SELECT" ? { inputType: "select" } : {}),
            ...(element.matches("input,textarea,select") && element.hasAttribute("autocomplete") ? { autocomplete: element.getAttribute("autocomplete")! } : {}),
            visible: isVisible(element),
            enabled: !control.disabled && element.getAttribute("aria-disabled") !== "true",
            locatorCandidates: candidates(element),
          };
        }),
      };
    }, elementLimit),
  ]);

  const omissions: string[] = [];
  if (collected.total > elementLimit) omissions.push(`${collected.total - elementLimit} interactive elements omitted by elementLimit`);
  const normalizeText = (text: string): string => limitText(text, textLimit).text;
  return {
    url: redactUrl(page.url(), options.redactionPolicy),
    headings: headings.map((heading) => ({ ...heading, text: normalizeText(heading.text) })),
    elements: collected.items.map((element) => ({ ...element, name: normalizeText(element.name) })),
    completeness: omissions.length === 0 ? "complete" : "partial",
    omissions,
  };
}
