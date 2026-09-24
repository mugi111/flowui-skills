import assert from "node:assert/strict";
import test from "node:test";
import { executeScenario, type ExecutionDriver } from "./execute.js";
import { createPermit } from "../safety/permit.js";
import type { ScenarioDocument, UiModelDocument } from "../contracts/types.js";

const scenario = {
  schema_version: "1.0", id: "edit", status: "draft", intent: "Change the name", start_page: "profile",
  inputs: { name: { type: "string", sensitive: false } },
  steps: [{ id: "fill-name", page: "profile", action: "fill", target: "name-field", value: { input: "name" } }],
};
const models: Readonly<Record<string, UiModelDocument>> = { profile: { schema_version: "1.0", page: { id: "profile", name: "Profile", identity: { landmarks: [{ role: "main", name: "Profile" }] } }, revision: "r1", elements: { "name-field": { state: "observed", role: "textbox", name: "Name" } } } };

function driver(overrides: Partial<ExecutionDriver> = {}, sent: string[] = []): ExecutionDriver {
  return {
    acquireTabLock: async () => () => undefined,
    inspectPage: async () => ({ pageId: "profile", origin: "https://example.test", state: "ready" }),
    resolveTarget: async (_page, id) => [{ id, scope: id }],
    sendAction: async (step) => { sent.push(step.id); },
    observeAction: async () => true,
    evaluateAssertion: async () => true,
    ...overrides,
  };
}

test("preflights required input before acquiring a tab lock", async () => {
  let acquired = 0;
  await assert.rejects(executeScenario({ scenario, models, environment: "test", driver: driver({ acquireTabLock: async () => { acquired++; return () => undefined; } }) }), /missing input/);
  assert.equal(acquired, 0);
});

test("rejects ordinary values for a sensitive Model target before acquiring a lock", async () => {
  let acquired = 0;
  const sensitiveModels: Readonly<Record<string, UiModelDocument>> = { profile: { ...models.profile!, elements: { "name-field": { state: "observed", role: "textbox", name: "Credential", inputType: "password" } } } };
  await assert.rejects(executeScenario({ scenario, models: sensitiveModels, inputs: { name: "private" }, environment: "test", driver: driver({ acquireTabLock: async () => { acquired++; return () => undefined; } }) }), /sensitive target requires a secret reference/);
  assert.equal(acquired, 0);
});

test("does not send a mutation without a matching permit", async () => {
  const sent: string[] = [];
  const result = await executeScenario({ scenario, models, inputs: { name: "Ada" }, environment: "test", driver: driver({}, sent) });
  assert.equal(result.status, "blocked");
  assert.deepEqual(sent, []);
});

test("does not act on an ambiguous Target", async () => {
  const sent: string[] = [];
  const result = await executeScenario({ scenario, models, inputs: { name: "Ada" }, environment: "test", driver: driver({ resolveTarget: async (_page, id) => [{ id, scope: id }, { id, scope: id }] }, sent) });
  assert.equal(result.status, "blocked");
  assert.deepEqual(sent, []);
});

test("does not send input outside Model constraints", async () => {
  const sent: string[] = [];
  const result = await executeScenario({ scenario, models, inputs: { name: "Ada" }, environment: "test", driver: driver({ resolveTarget: async (_page, id) => [{ id, scope: id, inputConstraints: { required: true, maxLength: 2 } }] }, sent) });
  assert.equal(result.status, "blocked");
  assert.deepEqual(sent, []);
});

test("does not send navigation to a different origin even with a Permit", async () => {
  const sent: string[] = [];
  const safeNavigation = { ...scenario, steps: [{ id: "go", page: "profile", action: "navigate", target: "name-field", value: "https://example.test/safe" }] } as unknown as ScenarioDocument;
  const unsafeNavigation = { ...safeNavigation, steps: [{ id: "go", page: "profile", action: "navigate", target: "name-field", value: "https://outside.test/" }] };
  const permit = createPermit(safeNavigation, models, { origin: "https://example.test", environment: "test", expiresAt: "2099-01-01T00:00:00Z", stepIds: ["go"] });
  const result = await executeScenario({ scenario: unsafeNavigation, models, inputs: { name: "Ada" }, permit, environment: "test", driver: driver({}, sent) });
  assert.equal(result.status, "blocked");
  assert.deepEqual(sent, []);
});

test("sends an action exactly once after a permit matches the fixed snapshots", async () => {
  const ready = { ...scenario, status: "ready", steps: [...scenario.steps, { id: "verify", page: "profile", assert: { type: "visible", target: "name-field" }, expectation: { source: "user-intent", reference: "confirm the field" } }] } as unknown as ScenarioDocument;
  const permit = createPermit(ready, models, { origin: "https://example.test", environment: "test", expiresAt: "2099-01-01T00:00:00Z", stepIds: ["fill-name"] });
  const sent: string[] = [];
  const result = await executeScenario({ scenario: ready, models, inputs: { name: "Ada" }, permit, environment: "test", testMode: true, driver: driver({}, sent) });
  assert.equal(result.status, "passed");
  assert.deepEqual(sent, ["fill-name"]);
});
