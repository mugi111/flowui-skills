import assert from "node:assert/strict";
import test from "node:test";

import { resolveTableRow, resolveTarget } from "./target.js";

const model = {
  schema_version: "1.0" as const,
  page: { id: "users", name: "Users", identity: { landmarks: [{ role: "heading", name: "Users" }] } },
  revision: "test",
  elements: { "edit-button": { state: "observed" as const, role: "button", name: "Edit" } },
};

test("resolves exactly one visible target", () => {
  const result = resolveTarget(model, "edit-button", [{ role: "button", name: "Edit", visible: true, locator: "#edit" }]);
  assert.equal(result.kind, "resolved");
});

test("does not select the first of multiple matching targets", () => {
  const result = resolveTarget(model, "edit-button", [
    { role: "button", name: "Edit", visible: true, locator: "#first" },
    { role: "button", name: "Edit", visible: true, locator: "#second" },
  ]);
  assert.equal(result.kind, "ambiguous");
});

test("requires a unique Table row match", () => {
  const result = resolveTableRow(
    [
      { index: 0, cells: { Email: "tester@example.test", Department: "QA" } },
      { index: 1, cells: { Email: "tester@example.test", Department: "Product" } },
    ],
    { Email: "tester@example.test" },
  );
  assert.equal(result.kind, "ambiguous");
});
