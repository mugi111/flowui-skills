import assert from "node:assert/strict";
import test from "node:test";

import { run } from "./index.js";

test("prints help without a command", () => {
  const result = run([]);

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /Usage:/);
});

test("prints the package version", () => {
  const result = run(["--version"]);

  assert.deepEqual(result, { exitCode: 0, output: "0.1.0" });
});

test("rejects a command that is not implemented", () => {
  const result = run(["unknown"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.output, /unsupported command/);
});
