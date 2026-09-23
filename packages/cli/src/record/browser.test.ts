import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

import { RecordCollector } from "./collector.js";
import { subscribeBrowserRecord } from "./browser.js";

test("redacts sensitive browser input before crossing the host binding", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const collector = new RecordCollector();
    const page = await context.newPage();
    await page.setContent('<label>Credential <input id="credential-entry" name="custom-secret" type="text"></label>');
    await subscribeBrowserRecord(context, collector, { sensitiveFields: ["custom-secret"] });
    await page.locator("input").fill("do-not-store-this");
    await page.waitForTimeout(20);
    const events = collector.stop();
    assert.ok(events.length > 0);
    assert.doesNotMatch(JSON.stringify(events), /do-not-store-this/);
    assert.ok(events.every((event) => event.value?.kind === "redacted"));
    await context.close();
  } finally { await browser.close(); }
});
