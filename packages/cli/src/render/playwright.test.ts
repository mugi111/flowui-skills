import assert from "node:assert/strict";
import test from "node:test";
import { renderPlaywright } from "./playwright.js";

test("renders a runnable gate-backed test with fixed Scenario and Model snapshots", () => {
  const output = renderPlaywright({ schema_version: "1.0", id: "x", status: "ready", intent: "check a page", start_page: "p", steps: [{ id: "check", page: "p", assert: { type: "visible", target: "title" }, expectation: { source: "user-intent", reference: "user request" } }] }, { p: { schema_version: "1.0", page: { id: "p", name: "Page", identity: { landmarks: [{ role: "heading", name: "Page" }] } }, revision: "fixed-revision", elements: { title: { state: "observed", role: "heading", name: "Page" } } } });
  assert.match(output, /executeScenario/);
  assert.match(output, /createPlaywrightExecutionDriver/);
  assert.match(output, /fixed-revision/);
  assert.match(output, /result\.status !== "passed"/);
  assert.doesNotMatch(output, /flowui\.run/);
});
