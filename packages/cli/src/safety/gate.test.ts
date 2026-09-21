import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGate } from "./gate.js";

const context = { scenarioHash: "scenario", modelHash: "model", environment: "test", now: new Date("2026-09-22T00:00:00Z") };
const permit = { scenarioHash: "scenario", modelHash: "model", environment: "test", actionIds: ["save"], targetScopes: ["user:42"], expiresAt: "2026-09-23T00:00:00Z" };

test("blocks unknown actions even with a permit", () => assert.deepEqual(evaluateGate({ id: "save", risk: "unknown", targetScope: "user:42" }, permit, context), { allowed: false, reason: "unknown-action" }));
test("requires a bound, unexpired permit for mutations", () => assert.deepEqual(evaluateGate({ id: "save", risk: "mutation", targetScope: "user:42" }, permit, context), { allowed: true }));
test("rejects permits when the Model changes", () => assert.deepEqual(evaluateGate({ id: "save", risk: "mutation", targetScope: "user:42" }, { ...permit, modelHash: "old" }, context), { allowed: false, reason: "permit-mismatch" }));
