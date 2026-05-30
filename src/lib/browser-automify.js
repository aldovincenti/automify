import { Automify } from "./automify.js";
import { createBrowserComputer } from "./playwright-computer.js";
import { applyBrowserPreset } from "./presets.js";
import { AUTOMIFY_OPTION_KEYS, assertKnownOptions, mergeOptionKeys, pickKnownOptions } from "./runtime.js";

const BROWSER_AUTOMIFY_OPTION_KEYS = mergeOptionKeys(AUTOMIFY_OPTION_KEYS, [
  "computer",
  "playwright",
  "browser",
  "browserName",
  "browserOptions",
  "headless",
  "startUrl",
  "url",
  "launch",
  "launchOptions",
  "context",
  "contextOptions",
  "navigation",
  "gotoOptions",
  "actionDelayMs",
  "waitMs",
  "onUnknownAction"
]);
const BROWSER_OPTIONS_KEYS = new Set(["name", "launch", "context", "navigation"]);

export async function createBrowserAutomify(options = {}) {
  assertKnownOptions("browser adapter", options, BROWSER_AUTOMIFY_OPTION_KEYS);
  assertKnownOptions("browserOptions", options.browserOptions, BROWSER_OPTIONS_KEYS);
  options = applyBrowserPreset(options);
  const browserOptions = browserOptionsFrom(options);
  const computer = options.computer ?? (await createBrowserComputer(browserOptions));

  return new BrowserAutomify({
    ...options,
    computer
  });
}

export async function withBrowserAutomify(options, run) {
  const automify = await createBrowserAutomify(options);

  try {
    return await run(automify);
  } finally {
    await automify.close();
  }
}

export class BrowserAutomify extends Automify {
  constructor(options) {
    super(pickKnownOptions(options, AUTOMIFY_OPTION_KEYS));
    this.browser = this.computer.browser;
    this.context = this.computer.context;
    this.page = this.computer.page;
  }

  async goto(url, options) {
    await this.computer.goto(url, options);
  }

  async close() {
    if (typeof this.computer.close === "function") {
      await this.computer.close();
    }
  }
}

function browserOptionsFrom(options) {
  const viewport = options.viewport ?? {};
  const browserOptions = options.browserOptions ?? {};
  return {
    playwright: options.playwright,
    browserName: options.browserName ?? options.browser ?? browserOptions.name,
    headless: options.headless,
    url: options.url ?? options.startUrl,
    displayWidth: options.displayWidth ?? viewport.width,
    displayHeight: options.displayHeight ?? viewport.height,
    environment: options.environment,
    launchOptions: options.launchOptions ?? options.launch ?? browserOptions.launch,
    contextOptions: options.contextOptions ?? options.context ?? browserOptions.context,
    gotoOptions: options.gotoOptions ?? options.navigation ?? browserOptions.navigation,
    waitMs: options.waitMs ?? options.actionDelayMs,
    silent: options.silent,
    debug: options.debug ?? false,
    logFile: options.logFile,
    onUnknownAction: options.onUnknownAction
  };
}
