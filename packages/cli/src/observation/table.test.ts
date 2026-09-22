import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

import { inspectTable } from "./table.js";

test("extracts rows by named columns and exact matching conditions", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table id="users"><thead><tr><th>Email</th><th>Department</th><th>Action</th></tr></thead>
      <tbody><tr><td>a@example.test</td><td>QA</td><td>Edit</td></tr><tr><td>b@example.test</td><td>Product</td><td>Edit</td></tr></tbody></table>
    `);
    const result = await inspectTable(page, "#users", { columns: ["Email", "Action"], where: { Department: "QA" }, matchingOnly: true });

    assert.deepEqual(result.rows, [{ Email: "a@example.test", Action: "Edit" }]);
    assert.equal(result.renderedRowCount, 2);
    assert.equal(result.scope, "rendered-rows-only");
  } finally {
    await browser.close();
  }
});

test("marks a capped Table response partial", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<table id=items><thead><tr><th>Name</th></tr></thead><tbody><tr><td>One</td></tr><tr><td>Two</td></tr></tbody></table>");
    const result = await inspectTable(page, "#items", { rowLimit: 1 });

    assert.equal(result.completeness, "partial");
    assert.match(result.omissions[0]!, /omitted/);
  } finally {
    await browser.close();
  }
});
