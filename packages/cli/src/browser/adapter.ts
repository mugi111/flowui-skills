import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserTab {
  readonly id: string;
  readonly isClosed: () => boolean;
  readonly onClose: (listener: () => void) => void;
}

export interface BrowserRuntime {
  readonly tabs: () => readonly BrowserTab[];
  readonly close: () => Promise<void>;
}

export interface BrowserLauncher {
  readonly launchVisible: () => Promise<BrowserRuntime>;
}

class PlaywrightTab implements BrowserTab {
  readonly id = crypto.randomUUID();

  constructor(private readonly page: Page) {}

  isClosed(): boolean {
    return this.page.isClosed();
  }

  onClose(listener: () => void): void {
    this.page.on("close", listener);
  }
}

class PlaywrightRuntime implements BrowserRuntime {
  private readonly registeredTabs = new Map<Page, PlaywrightTab>();

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
  ) {}

  tabs(): readonly BrowserTab[] {
    return this.context.pages().map((page) => {
      const existing = this.registeredTabs.get(page);
      if (existing !== undefined) return existing;
      const tab = new PlaywrightTab(page);
      this.registeredTabs.set(page, tab);
      return tab;
    });
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

export class PlaywrightBrowserLauncher implements BrowserLauncher {
  async launchVisible(): Promise<BrowserRuntime> {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    await context.newPage();
    return new PlaywrightRuntime(browser, context);
  }
}
