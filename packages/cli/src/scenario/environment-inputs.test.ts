import assert from "node:assert/strict";
import test from "node:test";
import { resolveEnvironmentInputs } from "./environment-inputs.js";

const definitions = {
  "display-name": { type: "string", sensitive: false },
  attempts: { type: "number", sensitive: false },
  enabled: { type: "boolean", sensitive: false },
  password: { type: "string", sensitive: true },
} as const;

test("converts declared environment inputs to their Scenario types", () => {
  const values = { FLOWUI_INPUT_DISPLAY_NAME: "Ada", FLOWUI_INPUT_ATTEMPTS: "2.5e1", FLOWUI_INPUT_ENABLED: "false" };
  assert.deepEqual(resolveEnvironmentInputs(definitions, (name) => values[name as keyof typeof values]), {
    "display-name": "Ada", attempts: 25, enabled: false,
  });
});

test("leaves missing inputs absent for executeScenario to reject before actions", () => {
  assert.deepEqual(resolveEnvironmentInputs(definitions, () => undefined), {});
});

test("does not load sensitive inputs through the ordinary input channel", () => {
  const values = resolveEnvironmentInputs(definitions, (name) => name.endsWith("PASSWORD") ? "must-not-be-read" : undefined);
  assert.equal("password" in values, false);
});

test("rejects invalid numbers and booleans without exposing their values", () => {
  assert.throws(() => resolveEnvironmentInputs(definitions, (name) => name.endsWith("ATTEMPTS") ? "private-value" : undefined), /invalid number environment input: attempts/);
  assert.throws(() => resolveEnvironmentInputs(definitions, (name) => name.endsWith("ENABLED") ? "yes" : undefined), /invalid boolean environment input: enabled/);
});
