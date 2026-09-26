import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectSafetyConfig, resolveEnvironmentSecrets } from "./config.js";

test("resolves direct and configured environment secret references", () => {
  const secrets = resolveEnvironmentSecrets(["env:INLINE_SECRET", "login-password", "unconfigured"], { "login-password": "env:LOGIN_PASSWORD" }, (name) => ({ INLINE_SECRET: "inline", LOGIN_PASSWORD: "configured" })[name]);
  assert.deepEqual(secrets, { "env:INLINE_SECRET": "inline", "login-password": "configured", unconfigured: undefined });
});

test("loads environment-backed secret aliases and marks their names sensitive", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowui-config-"));
  try {
    await mkdir(join(root, ".flowui"));
    await writeFile(join(root, ".flowui", "config.json"), JSON.stringify({ sensitive_fields: ["employee-id"], secret_references: { "login-password": "env:LOGIN_PASSWORD" } }));
    assert.deepEqual(await loadProjectSafetyConfig(root), {
      sensitiveFields: ["employee-id", "login-password"],
      secretReferences: { "login-password": "env:LOGIN_PASSWORD" },
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects vault and keychain references until a resolver is implemented", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowui-config-"));
  try {
    await mkdir(join(root, ".flowui"));
    await writeFile(join(root, ".flowui", "config.json"), JSON.stringify({ secret_references: { token: "vault:prod/token" } }));
    await assert.rejects(loadProjectSafetyConfig(root), /env:VARIABLE/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
