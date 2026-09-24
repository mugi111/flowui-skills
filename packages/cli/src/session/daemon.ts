import { createServer, connect, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PlaywrightBrowserLauncher } from "../browser/adapter.js";
import type { UiModelDocument } from "../contracts/types.js";
import { observePage } from "../observation/observe.js";
import { executeScenario } from "../scenario/execute.js";
import { createPlaywrightExecutionDriver } from "../scenario/playwright-driver.js";
import { RecordCollector } from "../record/collector.js";
import { subscribeBrowserRecord } from "../record/browser.js";
import { loadDocument } from "../contracts/document.js";
import { validateUiModelDocument } from "../contracts/validation.js";
import type { RedactionPolicy } from "../shared/redaction.js";
import { BrowserSession } from "./session.js";

export interface SessionRequest { readonly method: "start" | "status" | "close" | "inspect" | "capture" | "resolve-target" | "run" | "record-start" | "record-stop"; readonly tabId?: string; readonly pageId?: string; readonly targetId?: string; readonly scenario?: unknown; readonly models?: Readonly<Record<string, UiModelDocument>>; readonly inputs?: Readonly<Record<string, unknown>>; readonly secrets?: Readonly<Record<string, string | undefined>>; readonly permit?: import("../safety/gate.js").Permit; readonly environment?: string; readonly testMode?: boolean; readonly pauseBefore?: string; }
export interface SessionResponse { readonly ok: boolean; readonly result?: unknown; readonly error?: string; }
interface ProjectSafetyConfig extends RedactionPolicy { readonly secretReferences: Readonly<Record<string, string>>; }

async function projectSafetyConfig(): Promise<ProjectSafetyConfig> {
  const configPath = join(process.cwd(), ".flowui", "config.json");
  let raw: unknown;
  try { raw = await loadDocument(configPath); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { secretReferences: {} };
    throw new Error("invalid .flowui/config.json");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid .flowui/config.json");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["sensitive_fields", "secret_references"].includes(key))) throw new Error("unknown .flowui/config.json setting");
  if (value.sensitive_fields !== undefined && (!Array.isArray(value.sensitive_fields) || value.sensitive_fields.some((key) => typeof key !== "string"))) throw new Error("invalid sensitive_fields setting");
  if (value.secret_references !== undefined && (!value.secret_references || typeof value.secret_references !== "object" || Array.isArray(value.secret_references) || Object.values(value.secret_references).some((reference) => typeof reference !== "string" || !/^(env|vault|keychain):[A-Za-z0-9_.:/-]+$/.test(reference)))) throw new Error("invalid secret_references setting");
  const secretReferences = (value.secret_references ?? {}) as Record<string, string>;
  const sensitiveFields = [...(value.sensitive_fields as string[] | undefined ?? []), ...Object.keys(secretReferences)];
  return { ...(sensitiveFields.length === 0 ? {} : { sensitiveFields }), secretReferences };
}

async function projectTargetAliases(): Promise<Readonly<Record<string, string>>> {
  const directory = join(process.cwd(), ".flowui", "ui-model");
  let files: string[];
  try { files = await readdir(directory); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return {}; throw new Error("unable to read UI Models"); }
  const aliases = new Map<string, Set<string>>();
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    let raw: unknown;
    try { raw = await loadDocument(join(directory, file)); } catch { continue; }
    const result = validateUiModelDocument(raw);
    if (!result.ok) continue;
    for (const [targetId, element] of Object.entries(result.value.elements)) for (const alias of element.targetAliases ?? []) {
      const targets = aliases.get(alias) ?? new Set<string>();
      targets.add(targetId); aliases.set(alias, targets);
    }
  }
  return Object.fromEntries([...aliases].filter(([, targets]) => targets.size === 1).map(([alias, targets]) => [alias, [...targets][0]!]));
}

export function sessionSocketPath(projectDirectory: string): string {
  const id = createHash("sha256").update(resolve(projectDirectory)).digest("hex").slice(0, 24);
  return join("/tmp", `flowui-${process.getuid?.() ?? "user"}-${id}`, "session.sock");
}

export async function requestSession(projectDirectory: string, request: SessionRequest): Promise<SessionResponse> {
  const socketPath = sessionSocketPath(projectDirectory);
  await ensureSocketDirectory(socketPath);
  if (request.method === "start") await ensureDaemon(socketPath, projectDirectory);
  return new Promise((resolvePromise, reject) => {
    const socket: Socket = connect(socketPath);
    let response = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: string) => { response += chunk; if (response.length > 4 * 1024 * 1024) { socket.destroy(new Error("session response too large")); return; } });
    socket.on("end", () => {
      try { resolvePromise(JSON.parse(response) as SessionResponse); }
      catch { reject(new Error("invalid Session Service response")); }
    });
    socket.on("error", reject);
  });
}

async function ensureDaemon(socketPath: string, projectDirectory: string): Promise<void> {
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const socket = connect(socketPath);
      socket.once("connect", () => { socket.end(); resolvePromise(); });
      socket.once("error", reject);
    });
    return;
  } catch { /* A service may not be running yet. */ }
  const entry = fileURLToPath(new URL("../index.js", import.meta.url));
  const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: homedir(), TMPDIR: "/tmp", LANG: process.env.LANG ?? "C" };
  const child = spawn(process.execPath, [entry, "_session-daemon", socketPath], { cwd: projectDirectory, detached: true, stdio: "ignore", env: childEnv });
  child.unref();
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const socket = connect(socketPath);
        socket.once("connect", () => { socket.end(); resolvePromise(); });
        socket.once("error", reject);
      });
      return;
    } catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 50)); }
  }
  throw new Error("Session Service did not start");
}

export async function runSessionDaemon(socketPath: string): Promise<void> {
  await ensureSocketDirectory(socketPath);
  let session: BrowserSession | undefined;
  let collector: RecordCollector | undefined;
  let stopRecordObserver: (() => void) | undefined;
  const server = createServer((socket) => {
    let payload = "";
    let handled = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      payload += chunk;
      if (payload.length > 4 * 1024 * 1024) { socket.destroy(); return; }
      const newline = payload.indexOf("\n");
      if (newline < 0 || handled) return;
      handled = true;
      const line = payload.slice(0, newline);
      let method: SessionRequest["method"] | undefined;
      try { method = (JSON.parse(line) as SessionRequest).method; } catch { /* the handler returns a safe parse error */ }
      void handle(line).then((response) => {
        socket.end(`${JSON.stringify(response)}\n`);
        if (method === "close" && response.ok) setTimeout(() => { void server.close(); }, 100);
      });
    });
  });
  const handle = async (line: string): Promise<SessionResponse> => {
    try {
      const request = JSON.parse(line) as SessionRequest;
      if (!request || !["start", "status", "close", "inspect", "capture", "resolve-target", "run", "record-start", "record-stop"].includes(request.method)) return { ok: false, error: "invalid request" };
      if (request.method === "start") {
        session ??= await BrowserSession.start(new PlaywrightBrowserLauncher());
        return { ok: true, result: session.snapshot() };
      }
      const activeSession = session;
      if (!activeSession) return { ok: false, error: "SESSION_NOT_FOUND" };
      if (request.method === "status") return { ok: true, result: activeSession.snapshot() };
      if (request.method === "close") { stopRecordObserver?.(); stopRecordObserver = undefined; collector?.stop(); collector = undefined; await activeSession.close(); session = undefined; return { ok: true, result: { closed: true } }; }
      if (request.method === "record-start") {
        if (collector) return { ok: false, error: "RECORDING_ALREADY_ACTIVE" };
        if (activeSession.snapshot().state === "executing") return { ok: false, error: "SCENARIO_EXECUTING" };
        if (!activeSession.browserContext) return { ok: false, error: "BROWSER_CONTEXT_UNAVAILABLE" };
        const config = await projectSafetyConfig();
        const targetAliases = await projectTargetAliases();
        collector = new RecordCollector(config);
        try { stopRecordObserver = await subscribeBrowserRecord(activeSession.browserContext, collector, { ...config, targetAliases }); }
        catch (error) { collector = undefined; throw error; }
        activeSession.transition("recording");
        return { ok: true, result: { recording: true } };
      }
      if (request.method === "record-stop") {
        if (!collector) return { ok: false, error: "RECORDING_NOT_ACTIVE" };
        stopRecordObserver?.(); stopRecordObserver = undefined;
        const events = collector.stop(); collector = undefined;
        activeSession.transition("idle");
        return { ok: true, result: events };
      }
      if (request.method === "capture") {
        const snapshot = activeSession.snapshot();
        const tabs = snapshot.tabIds;
        if (!request.tabId && tabs.length !== 1) return { ok: false, error: "TAB_ID_REQUIRED" };
        const tabId = request.tabId ?? tabs[0];
        if (!tabId) return { ok: false, error: "TAB_NOT_FOUND" };
        return await activeSession.withTabLock(tabId, async (tab) => tab.page ? { ok: true, result: await observePage(tab.page) } : { ok: false, error: "TAB_UNAVAILABLE" });
      }
      const snapshot = activeSession.snapshot();
      const tabs = snapshot.tabIds;
      if (!request.tabId && tabs.length !== 1) return { ok: false, error: "TAB_ID_REQUIRED" };
      const tabId = request.tabId ?? tabs[0];
      if (!tabId) return { ok: false, error: "TAB_NOT_FOUND" };
      return await activeSession.withTabLock(tabId, async (tab) => {
        if (!tab.page) return { ok: false, error: "TAB_UNAVAILABLE" };
        if (request.method === "inspect") return { ok: true, result: await observePage(tab.page) };
        if (request.method === "resolve-target") {
          if (!request.pageId || !request.targetId || !request.models?.[request.pageId]) return { ok: false, error: "INVALID_TARGET_REQUEST" };
          const driver = createPlaywrightExecutionDriver(tab.page, request.models);
          const page = await driver.inspectPage();
          if (page.pageId !== request.pageId || page.state !== "ready") return { ok: false, error: "PAGE_MISMATCH" };
          return { ok: true, result: await driver.resolveTarget(request.pageId, request.targetId) };
        }
        if (!request.scenario || !request.models || !request.environment) return { ok: false, error: "INVALID_RUN_REQUEST" };
        const models = structuredClone(request.models) as Readonly<Record<string, UiModelDocument>>;
        const config = await projectSafetyConfig();
        if (activeSession.snapshot().state === "recording") return { ok: false, error: "RECORDING_ACTIVE" };
        activeSession.transition("executing");
        try {
          const result = await executeScenario({ scenario: request.scenario, models, environment: request.environment, driver: createPlaywrightExecutionDriver(tab.page, models), redactionPolicy: config, ...(request.inputs === undefined ? {} : { inputs: request.inputs }), ...(request.secrets === undefined ? {} : { secrets: request.secrets }), ...(request.permit === undefined ? {} : { permit: request.permit }), ...(request.testMode === undefined ? {} : { testMode: request.testMode }), ...(request.pauseBefore === undefined ? {} : { pauseBefore: request.pauseBefore }) });
          return { ok: true, result };
        } finally { if (activeSession.snapshot().state === "executing") activeSession.transition("idle"); }
      });
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "SESSION_SERVICE_ERROR" }; }
  };
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => { void chmod(socketPath, 0o600).then(resolvePromise, reject); });
  });
  server.once("close", () => { void unlink(socketPath); });
  await new Promise<void>((resolvePromise) => server.once("close", resolvePromise));
}

async function ensureSocketDirectory(socketPath: string): Promise<void> {
  const directory = join(socketPath, "..");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (process.getuid && metadata.uid !== process.getuid())) throw new Error("unsafe Session Service directory");
  await chmod(directory, 0o700);
}
