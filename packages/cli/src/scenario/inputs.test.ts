import assert from "node:assert/strict";
import test from "node:test";
import { resolveStepValue } from "./inputs.js";
test("does not resolve an absent secret", () => assert.deepEqual(resolveStepValue({ secret: "PASSWORD" }, {}, {}), { ok: false, reason: "missing-secret" }));
test("resolves input values without persisting them", () => assert.deepEqual(resolveStepValue({ input: "name" }, { name: "Ada" }, {}), { ok: true, value: "Ada" }));
