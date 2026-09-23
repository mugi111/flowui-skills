import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import type { UiModelDocument } from "../contracts/types.js";

const modelIdPattern = /^[a-z][a-z0-9-]*$/;
const lockWaitMs = 2_000;

export class StoreBusyError extends Error {
  readonly code = "STORE_BUSY";
  constructor(path: string) { super(`STORE_BUSY: ${path}`); }
}

export interface ModelConflict {
  readonly kind: "conflict";
  readonly expectedRevision: string;
  readonly actualRevision: string | undefined;
}

export interface ModelStored {
  readonly kind: "stored";
  readonly revision: string;
  readonly path: string;
}

export type StoreModelResult = ModelStored | ModelConflict;

export interface ModelDiff {
  readonly pageIdentityChanged: boolean;
  readonly addedElementIds: readonly string[];
  readonly removedElementIds: readonly string[];
  readonly changedElementIds: readonly string[];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function modelPath(projectDirectory: string, pageId: string): string {
  if (!modelIdPattern.test(pageId)) throw new Error("page id must use lowercase kebab-case");
  const base = resolve(projectDirectory, ".flowui", "ui-model");
  const target = resolve(base, `${pageId}.json`);
  if (!target.startsWith(`${base}${sep}`)) throw new Error("model path escaped the UI Model directory");
  return target;
}

export async function readUiModel(projectDirectory: string, pageId: string): Promise<UiModelDocument | undefined> {
  const path = modelPath(projectDirectory, pageId);
  try {
    return JSON.parse(await readFile(path, "utf8")) as UiModelDocument;
  } catch (error: unknown) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
}

export async function storeUiModel(
  projectDirectory: string,
  model: Omit<UiModelDocument, "revision">,
  expectedRevision?: string,
): Promise<StoreModelResult> {
  const path = modelPath(projectDirectory, model.page.id);
  return withWriteLock(path, async () => {
  const current = await readUiModel(projectDirectory, model.page.id);
  const actualRevision = current?.revision;
  if (expectedRevision === undefined ? current !== undefined : expectedRevision !== actualRevision) {
    return { kind: "conflict", expectedRevision: expectedRevision ?? "<new>", actualRevision };
  }

  const documentWithoutRevision = { ...model };
  const revision = contentHash(documentWithoutRevision);
  const document: UiModelDocument = { ...documentWithoutRevision, revision };
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${model.page.id}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    try { await unlink(temporaryPath); } catch (error) { if (!isNotFoundError(error)) throw error; }
  }
  return { kind: "stored", revision, path };
  });
}

async function withWriteLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + lockWaitMs;
  await mkdir(dirname(path), { recursive: true });
  let lock;
  while (!lock) {
    try {
      lock = await open(lockPath, "wx", 0o600);
      try { await lock.writeFile(`${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`); }
      catch (error) { await lock.close(); await unlink(lockPath); throw error; }
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      if (Date.now() >= deadline) throw new StoreBusyError(path);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try { return await operation(); }
  finally {
    await lock.close();
    try {
      const owner = JSON.parse(await readFile(lockPath, "utf8")) as { token?: string };
      if (owner.token === token) await unlink(lockPath);
    } catch (error) { if (!isNotFoundError(error)) throw error; }
  }
}

export function diffUiModels(before: UiModelDocument, after: UiModelDocument): ModelDiff {
  const beforeIds = new Set(Object.keys(before.elements));
  const afterIds = new Set(Object.keys(after.elements));
  const addedElementIds = [...afterIds].filter((id) => !beforeIds.has(id)).sort();
  const removedElementIds = [...beforeIds].filter((id) => !afterIds.has(id)).sort();
  const changedElementIds = [...beforeIds]
    .filter((id) => afterIds.has(id) && canonicalJson(before.elements[id]) !== canonicalJson(after.elements[id]))
    .sort();

  return {
    pageIdentityChanged: canonicalJson(before.page.identity) !== canonicalJson(after.page.identity),
    addedElementIds,
    removedElementIds,
    changedElementIds,
  };
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}
