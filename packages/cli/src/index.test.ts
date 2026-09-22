import assert from "node:assert/strict";
import test from "node:test";

import { run, runCommand } from "./index.js";

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

test("initializes the FlowUI project directory", async () => {
  const previous = process.cwd();
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "flowui-init-"));
  process.chdir(directory);
  try { assert.equal((await runCommand(["init"])).exitCode, 0); }
  finally { process.chdir(previous); }
});
