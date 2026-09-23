import type { BrowserContext } from "playwright";
import type { BrowserLauncher, BrowserRuntime, BrowserTab } from "../browser/adapter.js";

export type SessionState = "idle" | "recording" | "executing" | "paused" | "disconnected" | "closed";

export interface SessionSnapshot {
  readonly id: string;
  readonly state: SessionState;
  readonly tabIds: readonly string[];
}

export class BrowserSession {
  readonly id = crypto.randomUUID();
  private state: SessionState = "idle";
  private readonly lockedTabs = new Set<string>();
  private readonly trackedTabs = new Set<string>();

  private constructor(private readonly runtime: BrowserRuntime) { this.trackTabs(); }

  static async start(launcher: BrowserLauncher): Promise<BrowserSession> {
    return new BrowserSession(await launcher.launchVisible());
  }

  snapshot(): SessionSnapshot {
    this.trackTabs();
    return { id: this.id, state: this.state, tabIds: this.runtime.tabs().filter((tab) => !tab.isClosed()).map((tab) => tab.id) };
  }

  get browserContext(): BrowserContext | undefined { return this.runtime.context; }

  transition(next: Exclude<SessionState, "closed">): void {
    if (this.state === "closed") throw new Error("session is closed");
    if (this.state === "disconnected" && next !== "idle") throw new Error("a disconnected session must be inspected before reuse");
    this.state = next;
  }

  async withTabLock<T>(tabId: string, operation: (tab: BrowserTab) => Promise<T>): Promise<T> {
    this.trackTabs();
    if (this.state === "closed") throw new Error("session is closed");
    const tab = this.runtime.tabs().find((candidate) => candidate.id === tabId && !candidate.isClosed());
    if (tab === undefined) throw new Error("tab is unavailable");
    if (this.lockedTabs.has(tabId)) throw new Error("tab is already in use");
    this.lockedTabs.add(tabId);
    try {
      return await operation(tab);
    } finally {
      this.lockedTabs.delete(tabId);
    }
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    await this.runtime.close();
  }

  private handleTabClose(closedTab: BrowserTab): void {
    this.lockedTabs.delete(closedTab.id);
    if (this.runtime.tabs().every((tab) => tab.isClosed())) this.state = "disconnected";
  }

  private trackTabs(): void {
    for (const tab of this.runtime.tabs()) {
      if (this.trackedTabs.has(tab.id)) continue;
      this.trackedTabs.add(tab.id);
      tab.onClose(() => this.handleTabClose(tab));
    }
  }
}
