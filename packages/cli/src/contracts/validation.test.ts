import assert from "node:assert/strict";
import test from "node:test";

import { validateScenarioAgainstModel, validateScenarioDocument } from "./validation.js";

const readyScenario = {
  schema_version: "1.0",
  id: "edit-user",
  status: "ready",
  intent: "Update the visible user name",
  start_page: "user-edit",
  inputs: { name: { type: "string", sensitive: false } },
  steps: [
    { id: "fill-name", page: "user-edit", action: "fill", target: "display-name", value: { input: "name" } },
    {
      id: "verify-result",
      page: "user-edit",
      assert: { type: "text", target: "save-status", equals: "Saved" },
      expectation: { source: "user-intent", reference: "The tester requires a save confirmation" },
    },
  ],
};

test("accepts a ready Scenario with a user-backed assertion", () => {
  const result = validateScenarioDocument(readyScenario);

  assert.equal(result.ok, true);
});

test("rejects a ready Scenario without an assertion", () => {
  const result = validateScenarioDocument({ ...readyScenario, steps: [readyScenario.steps[0]] });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "ready-requires-assertion"));
});

test("rejects a Step that mixes action and assertion", () => {
  const result = validateScenarioDocument({
    ...readyScenario,
    steps: [{ ...readyScenario.steps[0]!, assert: readyScenario.steps[1]!.assert, expectation: readyScenario.steps[1]!.expectation }],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "step-kind"));
});

test("rejects an unsupported schema version", () => {
  const result = validateScenarioDocument({ ...readyScenario, schema_version: "2.0" });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "unsupported-version"));
});

test("rejects a sensitive input passed by regular input reference", () => {
  const result = validateScenarioDocument({
    ...readyScenario,
    inputs: { password: { type: "string", sensitive: true } },
    steps: [{ ...readyScenario.steps[0]!, value: { input: "password" } }, readyScenario.steps[1]!],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "sensitive-input-reference"));
});

test("rejects a ready Scenario whose target is absent from the Model", () => {
  const scenario = validateScenarioDocument(readyScenario);
  assert.equal(scenario.ok, true);
  if (!scenario.ok) return;

  const result = validateScenarioAgainstModel(scenario.value, {
    schema_version: "1.0",
    page: { id: "user-edit", name: "Edit user", identity: { landmarks: [{ role: "heading", name: "Edit user" }] } },
    revision: "test-revision",
    elements: { "display-name": { state: "observed", role: "textbox", name: "Display name" } },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "unresolved-target"));
});
