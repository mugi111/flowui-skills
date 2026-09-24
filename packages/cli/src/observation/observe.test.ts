import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

import { observePage } from "./observe.js";

test("observes semantic interactive elements without capturing input values", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <h1>Account settings</h1>
      <input id="password" aria-label="Password" type="password" value="do-not-leak" />
      <button data-testid="save">Save</button>
      <button disabled>Disabled action</button>
    `);

    const observation = await observePage(page);
    assert.deepEqual(observation.headings, [{ level: 1, text: "Account settings" }]);
    assert.deepEqual(observation.elements.map((element) => [element.role, element.name, element.enabled]), [
      ["textbox", "Password", true],
      ["button", "Save", true],
      ["button", "Disabled action", false],
    ]);
    assert.equal(observation.elements[0]?.inputType, "password");
    assert.doesNotMatch(JSON.stringify(observation), /do-not-leak/);
  } finally {
    await browser.close();
  }
});

test("marks capped element output as partial and redacts the URL", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://example.test/**", async (route) => route.fulfill({ contentType: "text/html", body: "<button>One</button><button>Two</button>" }));
    await page.goto("https://example.test/?token=private");

    const observation = await observePage(page, { elementLimit: 1 });
    assert.equal(observation.completeness, "partial");
    assert.match(observation.url, /REDACTED/);
    assert.equal(observation.elements.length, 1);
  } finally {
    await browser.close();
  }
});
