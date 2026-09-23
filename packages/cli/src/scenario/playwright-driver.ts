import type { Page, Locator } from "playwright";
import type { AssertionStep, UiModelDocument } from "../contracts/types.js";
import type { ExecutionDriver, ResolvedTarget } from "./execute.js";

export function createPlaywrightExecutionDriver(page: Page, models: Readonly<Record<string, UiModelDocument>>): ExecutionDriver {
  const snapshot = structuredClone(models);
  let locked = false;
  const modelFor = (pageId: string) => snapshot[pageId];
  const locatorFor = (targetId: string, pageId: string): Locator | undefined => {
    const element = modelFor(pageId)?.elements[targetId];
    if (!element) return undefined;
    return page.getByRole(element.role as never, { name: element.name, exact: true });
  };
  return {
    acquireTabLock: async () => {
      if (locked) throw new Error("tab is already in use");
      locked = true;
      let released = false;
      return () => { if (!released) { released = true; locked = false; } };
    },
    inspectPage: async () => {
      const currentOrigin = new URL(page.url()).origin;
      // Check identity sequentially because Page locators are asynchronous.
      let identified: UiModelDocument | undefined;
      for (const candidate of Object.values(snapshot)) {
        let matches = true;
        for (const landmark of candidate.page.identity.landmarks) {
          if (await page.getByRole(landmark.role as never, { name: landmark.name, exact: true }).count() === 0) { matches = false; break; }
        }
        if (matches) { identified = candidate; break; }
      }
      return { pageId: identified?.page.id ?? "unknown", origin: currentOrigin, state: identified ? "ready" : "unknown" };
    },
    resolveTarget: async (pageId, logicalTarget) => {
      const locator = locatorFor(logicalTarget, pageId);
      if (!locator) return [];
      const count = await locator.count();
      const matches: ResolvedTarget[] = [];
      for (let index = 0; index < count; index++) {
        if (await locator.nth(index).isVisible()) matches.push({ id: logicalTarget, scope: logicalTarget });
      }
      return matches;
    },
    classifyAction: async (step, target) => ({ id: step.action, risk: "mutation", targetScope: target.scope }),
    sendAction: async (step, target, value) => {
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
    observeAction: async () => !page.isClosed(),
    evaluateAssertion: async (step) => {
      const assertion = (step as AssertionStep).assert;
      if (assertion.type === "url") return page.url() === String(assertion.equals ?? assertion.target);
      if (assertion.type === "page") return page.url().includes(assertion.target);
      if (assertion.type === "state") return true;
      const locator = locatorFor(assertion.target, step.page);
      if (!locator) return false;
      switch (assertion.type) {
        case "visible": return locator.isVisible();
        case "hidden": return !(await locator.isVisible());
        case "enabled": return locator.isEnabled();
        case "disabled": return !(await locator.isEnabled());
        case "text": return await locator.innerText() === String(assertion.equals ?? "");
        case "value": return await locator.inputValue() === String(assertion.equals ?? "");
        case "row-count": return await locator.count() === Number(assertion.equals);
      }
    },
  };
}
