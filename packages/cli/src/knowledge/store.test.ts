import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { contentHash, diffUiModels, readUiModel, storeUiModel } from "./store.js";

const model = {
  schema_version: "1.0" as const,
  page: { id: "user-edit", name: "Edit user", identity: { landmarks: [{ role: "heading", name: "Edit user" }] } },
  elements: { "save-button": { state: "observed" as const, role: "button", name: "Save" } },
};

test("hashes equivalent object properties deterministically", () => {
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
});

test("stores and reads a UI Model", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "flowui-store-"));
  const result = await storeUiModel(projectDirectory, model);

  assert.equal(result.kind, "stored");
  const stored = await readUiModel(projectDirectory, "user-edit");
  assert.equal(stored?.revision, result.revision);
  assert.deepEqual(stored?.elements, model.elements);
});

test("rejects a stale model revision without overwriting the stored Model", async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), "flowui-store-"));
  const first = await storeUiModel(projectDirectory, model);
  assert.equal(first.kind, "stored");
  const conflict = await storeUiModel(projectDirectory, { ...model, elements: {} }, "stale-revision");

  assert.deepEqual(conflict, { kind: "conflict", expectedRevision: "stale-revision", actualRevision: first.revision });
  assert.deepEqual((await readUiModel(projectDirectory, "user-edit"))?.elements, model.elements);
});

test("reports semantic element changes by logical ID", () => {
  const before = { ...model, revision: "before" };
  const after = {
    ...model,
    revision: "after",
    elements: {
      "save-button": { state: "observed" as const, role: "button", name: "Save changes" },
      "cancel-button": { state: "observed" as const, role: "button", name: "Cancel" },
    },
  };

  assert.deepEqual(diffUiModels(before, after), {
    pageIdentityChanged: false,
    addedElementIds: ["cancel-button"],
    removedElementIds: [],
    changedElementIds: ["save-button"],
  });
});
