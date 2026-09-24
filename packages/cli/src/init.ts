import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function initialize(project: string): Promise<void> {
  const root = join(project, ".flowui");
  for (const path of ["ui-model", "scenarios", "results", "analysis", "candidates"]) await mkdir(join(root, path), { recursive: true, mode: 0o700 });
  await createFile(join(root, "pages.yaml"), "pages: []\n");
  await createFile(join(root, "config.json"), `${JSON.stringify({ sensitive_fields: [], secret_references: {} }, null, 2)}\n`);
}

async function createFile(path: string, contents: string): Promise<void> {
  try { await writeFile(path, contents, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error; }
}
