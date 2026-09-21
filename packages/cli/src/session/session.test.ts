import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserLauncher, BrowserRuntime, BrowserTab } from "../browser/adapter.js";
import { BrowserSession } from "./session.js";

class FakeTab implements BrowserTab {
  private closed = false;
  private closeListener: (() => void) | undefined;

  constructor(readonly id: string) {}

  isClosed(): boolean {
    return this.closed;
  }

  onClose(listener: () => void): void {
    this.closeListener = listener;
  }

  close(): void {
    this.closed = true;
    this.closeListener?.();
  }
}

class FakeRuntime implements BrowserRuntime {
  closed = false;

  constructor(private readonly allTabs: readonly FakeTab[]) {}

  tabs(): readonly BrowserTab[] {
    return this.allTabs;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function fakeLauncher(runtime: BrowserRuntime): BrowserLauncher {
  return { launchVisible: async () => runtime };
}

test("retains an open browser until the session is explicitly closed", async () => {
  const runtime = new FakeRuntime([new FakeTab("first")]);
  const session = await BrowserSession.start(fakeLauncher(runtime));

  assert.equal(session.snapshot().state, "idle");
  assert.equal(runtime.closed, false);
  await session.close();
  assert.equal(runtime.closed, true);
});

test("does not allow concurrent work on the same tab", async () => {
  const session = await BrowserSession.start(fakeLauncher(new FakeRuntime([new FakeTab("first")])));
  const first = session.withTabLock("first", async () => new Promise<void>((resolve) => setTimeout(resolve, 15)));

  await assert.rejects(session.withTabLock("first", async () => undefined), /already in use/);
  await first;
});

test("marks the session disconnected when the final tab closes", async () => {
  const tab = new FakeTab("first");
  const session = await BrowserSession.start(fakeLauncher(new FakeRuntime([tab])));

  tab.close();
  assert.equal(session.snapshot().state, "disconnected");
});
