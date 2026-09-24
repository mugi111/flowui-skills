import type { Page, Locator } from "playwright";
import type { AssertionStep, InputConstraints, UiModelDocument } from "../contracts/types.js";
import type { ExecutionDriver, ResolvedTarget } from "./execute.js";
import { contentHash } from "../knowledge/store.js";

export function createPlaywrightExecutionDriver(page: Page, models: Readonly<Record<string, UiModelDocument>>): ExecutionDriver {
  const snapshot = structuredClone(models);
  let locked = false;
  let dispatchedOrigin: string | undefined;
  const modelFor = (pageId: string) => snapshot[pageId];
  const locatorFor = (targetId: string, pageId: string): Locator | undefined => {
    const element = modelFor(pageId)?.elements[targetId];
    if (!element) return undefined;
    return page.getByRole(element.role as never, { name: element.name, exact: true });
  };
  const inspectPage = async () => {
    const currentOrigin = new URL(page.url()).origin;
    const identified: UiModelDocument[] = [];
    for (const candidate of Object.values(snapshot)) {
      let matches = true;
      for (const landmark of candidate.page.identity.landmarks) {
        if (await page.getByRole(landmark.role as never, { name: landmark.name, exact: true }).count() === 0) { matches = false; break; }
      }
      if (matches) identified.push(candidate);
    }
    return { pageId: identified.length === 1 ? identified[0]!.page.id : "unknown", origin: currentOrigin, state: identified.length === 1 ? "ready" : "unknown" };
  };
  const resolveTarget = async (pageId: string, logicalTarget: string): Promise<readonly ResolvedTarget[]> => {
    const locator = locatorFor(logicalTarget, pageId);
    if (!locator) return [];
    const count = await locator.count();
    const matches: ResolvedTarget[] = [];
    for (let index = 0; index < count; index++) {
      const item = locator.nth(index);
      if (!(await item.isVisible())) continue;
      const actual = await item.evaluate((element) => {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return undefined;
        return {
          ...(element.required ? { required: true } : {}),
          ...(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.minLength >= 0 ? { minLength: element.minLength } : {} : {}),
          ...(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.maxLength >= 0 ? { maxLength: element.maxLength } : {} : {}),
          ...(element.getAttribute("pattern") ? { pattern: element.getAttribute("pattern")! } : {}),
        };
      });
      const constraints: InputConstraints | undefined = actual && Object.keys(actual).length ? actual : undefined;
      if (contentHash(constraints ?? null) !== contentHash(modelFor(pageId)?.elements[logicalTarget]?.inputConstraints ?? null)) continue;
      matches.push({ id: logicalTarget, scope: logicalTarget, ...(constraints === undefined ? {} : { inputConstraints: constraints }) });
    }
    return matches;
  };
  return {
    acquireTabLock: async () => {
      if (locked) throw new Error("tab is already in use");
      locked = true;
      let released = false;
      return () => { if (!released) { released = true; locked = false; } };
    },
    inspectPage,
    resolveTarget,
    sendAction: async (step, target, value, expectedOrigin) => {
      const current = await page.evaluate(() => location.origin);
      if (current !== expectedOrigin) throw new Error("Page origin changed before action dispatch");
      const currentPage = await inspectPage();
      if (currentPage.pageId !== step.page || currentPage.state !== "ready") throw new Error("Page identity changed before action dispatch");
      const matches = await resolveTarget(step.page, target.id);
      if (matches.length !== 1 || contentHash(matches[0]) !== contentHash(target)) throw new Error("Target changed before action dispatch");
      dispatchedOrigin = expectedOrigin;
      const locator = locatorFor(target.id, step.page);
      if (!locator) throw new Error("Target is missing from the fixed Model snapshot");
      if (step.action === "navigate") { await page.goto(String(value ?? "")); return; }
      switch (step.action) {
        case "click": await locator.click(); return;
        case "fill": await locator.fill(String(value ?? "")); return;
        case "select": await locator.selectOption(String(value ?? "")); return;
        case "check": await locator.check(); return;
        case "uncheck": await locator.uncheck(); return;
        case "press": await locator.press(String(value ?? "")); return;
      }
    },
    observeAction: async () => {
      if (page.isClosed()) throw new Error("Page closed after action dispatch");
      const current = await inspectPage();
      if (current.state !== "ready" || current.origin !== dispatchedOrigin) throw new Error("Page state could not be verified after action dispatch");
      return true;
    },
    evaluateAssertion: async (step) => {
      const assertion = (step as AssertionStep).assert;
      const currentPage = await inspectPage();
      if (currentPage.pageId !== step.page || currentPage.state !== "ready") return false;
      if (assertion.type === "url") return page.url() === String(assertion.equals ?? assertion.target);
      if (assertion.type === "page") return page.url().includes(assertion.target);
      if (assertion.type === "state") return modelFor(step.page)?.elements[assertion.target]?.state === assertion.equals;
      const locator = locatorFor(assertion.target, step.page);
      if (!locator) return false;
      const count = await locator.count();
      if (assertion.type === "hidden") return count === 0 || (count === 1 && !(await locator.isVisible()));
      if (count !== 1) return false;
      switch (assertion.type) {
        case "visible": return locator.isVisible();
        case "enabled": return locator.isEnabled();
        case "disabled": return !(await locator.isEnabled());
        case "text": return await locator.innerText() === String(assertion.equals ?? "");
        case "value": return await locator.inputValue() === String(assertion.equals ?? "");
        case "row-count": return count === Number(assertion.equals);
      }
    },
  };
}
