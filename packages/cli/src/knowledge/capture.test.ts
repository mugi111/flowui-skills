import assert from "node:assert/strict";
import test from "node:test";

import { createCaptureCandidate, identifyPage } from "./capture.js";

const observation = {
  url: "https://app.example.test/users/42/edit",
  headings: [{ level: 1, text: "Edit User" }],
  elements: [{ id: "observed-1", role: "button", name: "Save", visible: true, enabled: true, locatorCandidates: ["#save"] }],
  completeness: "complete" as const,
  omissions: [],
};

test("identifies a Page only when URL and all required landmarks match", () => {
  const result = identifyPage(observation, [{ id: "user-edit", urlPattern: /\/users\/\d+\/edit$/, landmarks: [{ role: "heading", name: "Edit User" }] }]);

  assert.equal(result.kind, "identified");
  if (result.kind === "identified") assert.equal(result.page.id, "user-edit");
});

test("does not force an unknown Page into a known definition", () => {
  const result = identifyPage(observation, [{ id: "user-list", landmarks: [{ role: "heading", name: "Users" }] }]);

  assert.deepEqual(result, { kind: "unknown" });
});

test("returns ambiguity rather than choosing the first matching Page", () => {
  const result = identifyPage(observation, [
    { id: "user-edit-a", landmarks: [{ role: "heading", name: "Edit User" }] },
    { id: "user-edit-b", landmarks: [{ role: "heading", name: "Edit User" }] },
  ]);

  assert.deepEqual(result, { kind: "ambiguous", candidateIds: ["user-edit-a", "user-edit-b"] });
});

test("Capture produces an unaccepted candidate instead of modifying a Model", () => {
  const candidate = createCaptureCandidate(observation, [{ id: "user-edit", landmarks: [{ role: "heading", name: "Edit User" }] }]);

  assert.equal(candidate.requiresAcceptance, true);
  assert.deepEqual(candidate.model?.elements, { "button-save-1": { state: "observed", role: "button", name: "Save" } });
});
