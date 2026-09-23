import assert from "node:assert/strict";
import test from "node:test";
import { executeScenario, type ExecutionDriver } from "./execute.js";

const scenario = {
  schema_version: "1.0", id: "edit", status: "draft", intent: "Change the name", start_page: "profile",
  inputs: { name: { type: "string", sensitive: false } },
  steps: [{ id: "fill-name", page: "profile", action: "fill", target: "name-field", value: { input: "name" } }],
};
const models = { profile: { schema_version: "1.0", page: { id: "profile", name: "Profile", identity: { landmarks: [{ role: "main", name: "Profile" }] } }, revision: "r1", elements: { "name-field": { state: "observed", role: "textbox", name: "Name" } } } };

function driver(overrides: Partial<ExecutionDriver> = {}, sent: string[] = []): ExecutionDriver {
  return {
    acquireTabLock: async () => () => undefined,
    inspectPage: async () => ({ pageId: "profile", origin: "https://example.test", state: "ready" }),
    resolveTarget: async (_page, id) => [{ id, scope: id }],
    classifyAction: async (step, target) => ({ id: step.action, risk: "mutation", targetScope: target.scope }),
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

test("does not act when action classification is unknown", async () => {
  const sent: string[] = [];
  const result = await executeScenario({ scenario, models, inputs: { name: "Ada" }, environment: "test", driver: driver({ classifyAction: async () => ({ id: "fill", risk: "unknown", targetScope: "name-field" }) }, sent) });
  assert.equal(result.status, "blocked");
  assert.deepEqual(sent, []);
});
