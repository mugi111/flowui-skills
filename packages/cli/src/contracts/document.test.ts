import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DocumentLoadError, loadDocument } from "./document.js";

test("loads YAML and equivalent JSON values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flowui-document-"));
  try {
    const yaml = join(directory, "scenario.yaml");
    const json = join(directory, "scenario.json");
    await writeFile(yaml, "id: demo\nitems:\n  - alpha\n");
    await writeFile(json, '{"id":"demo","items":["alpha"]}');
    assert.deepEqual(await loadDocument(yaml), await loadDocument(json));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects duplicate keys and multiple YAML documents without echoing contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flowui-document-"));
  try {
    const file = join(directory, "invalid.yml");
    await writeFile(file, "secret-value: private\nsecret-value: private\n---\nother: value\n");
    await assert.rejects(loadDocument(file), (error: unknown) => error instanceof DocumentLoadError && !error.message.includes("private"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects custom tags, excessive aliases, and oversized documents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flowui-document-"));
  try {
    const tagFile = join(directory, "tag.yaml");
    await writeFile(tagFile, "value: !custom secret\n");
    await assert.rejects(loadDocument(tagFile), DocumentLoadError);
    const aliasesFile = join(directory, "aliases.yaml");
    await writeFile(aliasesFile, `base: &base [value]\nitems: [${Array.from({ length: 24 }, () => "*base").join(", ")}]\n`);
    await assert.rejects(loadDocument(aliasesFile), DocumentLoadError);
    const largeFile = join(directory, "large.json");
    await writeFile(largeFile, `{"value":"${"x".repeat(2 * 1024 * 1024)}"}`);
    await assert.rejects(loadDocument(largeFile), (error: unknown) => error instanceof DocumentLoadError && error.code === "DOCUMENT_TOO_LARGE");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
