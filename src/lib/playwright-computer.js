import { AutomifyError } from "./errors.js";
import { assertKnownOptions, normalizeLogFile, writeDebugLogFile } from "./runtime.js";

const KEY_ALIASES = new Map([
  ["alt", "Alt"],
  ["cmd", "Meta"],
  ["command", "Meta"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["enter", "Enter"],
  ["meta", "Meta"],
  ["option", "Alt"],
  ["shift", "Shift"],
  ["space", " "],
  ["tab", "Tab"],
  ["escape", "Escape"],
  ["esc", "Escape"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["arrowup", "ArrowUp"],
  ["arrowdown", "ArrowDown"],
  ["arrowleft", "ArrowLeft"],
  ["arrowright", "ArrowRight"]
]);
const DEFAULT_BROWSER_INSTRUCTIONS = [
  "You are controlling a browser through screenshots and mouse/keyboard actions.",
  "Orient from the screenshot and current URL first: identify the page, focused field, visible controls, and the specific target required by the task before acting.",
  "Use deterministic browser controls. For a known URL, focus the address bar and type the URL instead of searching or clicking around. For content inside the current app, use visible search/filter fields, tabs, menus, or clear navigation controls.",
  "Do not click as a probe. Click only when the screenshot shows a specific visible target and the purpose of that click is clear from the task or current UI. Prefer named controls, links, fields, tabs, and menu items over unlabeled regions.",
  "Do not navigate away from the current app unless the task requires it, provides a target URL/domain, or the current page is clearly unrelated. Respect any allowed-domain policy.",
  "If the target is not visible, choose a deterministic recovery path: in-page search/filter, browser address bar for a known URL, visible navigation, scroll only when content is likely below, or wait only when loading is visible. Do not repeat nearly identical clicks after no visible change.",
  "After any action that navigates, submits, opens a dialog, changes page state, or might trigger loading, use the next screenshot to decide the next step. Stop when the requested result is known; do not keep interacting to confirm unnecessarily."
].join("\n");
const BROWSER_COMPUTER_OPTION_KEYS = new Set([
  "playwright",
  "browser",
  "browserName",
  "browserOptions",
  "headless",
  "startUrl",
  "url",
  "viewport",
  "displayWidth",
  "displayHeight",
  "environment",
  "launch",
  "launchOptions",
  "context",
  "contextOptions",
  "navigation",
  "gotoOptions",
  "actionDelayMs",
  "waitMs",
  "instructions",
  "silent",
  "debug",
  "logFile",
  "onUnknownAction"
]);
const BROWSER_OPTIONS_KEYS = new Set(["name", "launch", "context", "navigation"]);

export async function createBrowserComputer(options = {}) {
  options = normalizeBrowserComputerOptions(options);
  const playwright = options.playwright ?? (await importPlaywright());
  const browserName = options.browserName ?? "chromium";
  const browserType = playwright[browserName];

  if (!browserType || typeof browserType.launch !== "function") {
    throw new AutomifyError(`Unsupported Playwright browserName: ${browserName}`);
  }

  const displayWidth = options.displayWidth ?? 1024;
  const displayHeight = options.displayHeight ?? 768;
  debugPlaywrightComputer(options, "setup_start", {
    browserName,
    headless: options.headless ?? true,
    url: options.url,
    width: displayWidth,
    height: displayHeight
  });
  const browser = await browserType.launch({
    headless: options.headless ?? true,
    ...options.launchOptions
  });

  try {
    const context = await browser.newContext({
      viewport: { width: displayWidth, height: displayHeight },
      ...options.contextOptions
    });
    const page = await context.newPage();

    if (options.url) {
      await page.goto(options.url, options.gotoOptions);
    }
    debugPlaywrightComputer(options, "setup_complete", {
      browserName,
      url: typeof page.url === "function" ? page.url() : options.url,
      width: displayWidth,
      height: displayHeight
    });

    const computer = createPlaywrightComputer(page, {
      ...options,
      displayWidth,
      displayHeight
    });

    return {
      ...computer,
      browser,
      context,
      page,
      async goto(url, gotoOptions = options.gotoOptions) {
        await page.goto(url, gotoOptions);
      },
      async close() {
        await browser.close();
      }
    };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

export function createPlaywrightComputer(page, options = {}) {
  options = normalizeBrowserComputerOptions(options);
  return {
    displayWidth: options.displayWidth ?? page.viewportSize()?.width ?? 1024,
    displayHeight: options.displayHeight ?? page.viewportSize()?.height ?? 768,
    environment: options.environment ?? "browser",
    instructions: options.instructions ?? DEFAULT_BROWSER_INSTRUCTIONS,

    async execute(action) {
      await executePlaywrightAction(page, action, options);
    },

    async screenshot(context) {
      const startedAt = Date.now();
      if (context?.initial || context?.final) {
        try {
          await page.waitForLoadState("networkidle", { timeout: 2000 });
        } catch {}
        await page
          .evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
          .catch(() => {});
      }
      const screenshot = await page.screenshot({ fullPage: false, animations: "disabled" });
      debugPlaywrightComputer(options, "screenshot", {
        phase: context?.final ? "final" : context?.initial ? "initial" : "step",
        bytes: screenshot?.byteLength,
        durationMs: Date.now() - startedAt,
        url: typeof page.url === "function" ? page.url() : undefined
      });
      return screenshot;
    },

    async currentUrl() {
      return page.url();
    }
  };
}

function normalizeBrowserComputerOptions(options = {}) {
  assertKnownOptions("browser adapter", options, BROWSER_COMPUTER_OPTION_KEYS);
  assertKnownOptions("browserOptions", options.browserOptions, BROWSER_OPTIONS_KEYS);
  const viewport = options.viewport ?? {};
  const browserOptions = options.browserOptions ?? {};
  return {
    ...options,
    debug: options.debug ?? false,
    logFile: normalizeLogFile(options.logFile, "browser adapter logFile"),
    browserName: options.browserName ?? options.browser ?? browserOptions.name,
    url: options.url ?? options.startUrl,
    displayWidth: options.displayWidth ?? viewport.width,
    displayHeight: options.displayHeight ?? viewport.height,
    launchOptions: options.launchOptions ?? options.launch ?? browserOptions.launch,
    contextOptions: options.contextOptions ?? options.context ?? browserOptions.context,
    gotoOptions: options.gotoOptions ?? options.navigation ?? browserOptions.navigation,
    waitMs: options.waitMs ?? options.actionDelayMs
  };
}

export async function executePlaywrightAction(page, action, options = {}) {
  debugPlaywrightComputer(options, "action", { action });

  switch (action.type) {
    case "click":
      debugPlaywrightComputer(options, "mouse", {
        method: "click",
        input: { x: action.x, y: action.y },
        button: normalizeButton(action.button)
      });
      await page.mouse.click(action.x, action.y, {
        button: normalizeButton(action.button)
      });
      break;
    case "double_click":
      debugPlaywrightComputer(options, "mouse", {
        method: "double_click",
        input: { x: action.x, y: action.y },
        button: normalizeButton(action.button)
      });
      await page.mouse.dblclick(action.x, action.y, {
        button: normalizeButton(action.button)
      });
      break;
    case "scroll":
      debugPlaywrightComputer(options, "mouse", {
        method: "scroll",
        input: { x: action.x, y: action.y },
        scrollX: action.scroll_x ?? 0,
        scrollY: action.scroll_y ?? 0
      });
      await page.mouse.move(action.x, action.y);
      await page.evaluate(
        ([scrollX, scrollY]) => window.scrollBy(scrollX, scrollY),
        [action.scroll_x ?? 0, action.scroll_y ?? 0]
      );
      break;
    case "keypress":
      {
        const keys = action.keys ?? [action.key].filter(Boolean);
        if (keys.length === 0) {
          throw new AutomifyError("keypress action did not include any keys.");
        }
        const output = normalizeKeypress(keys);
        debugPlaywrightComputer(options, "keyboard", {
          method: "press",
          input: keys,
          output
        });
        await page.keyboard.press(output);
      }
      break;
    case "type":
      debugPlaywrightComputer(options, "keyboard", {
        method: "type",
        text: action.text ?? ""
      });
      await page.keyboard.type(action.text ?? "");
      break;
    case "wait":
      await page.waitForTimeout(options.waitMs ?? 1000);
      break;
    case "screenshot":
      break;
    case "move":
      debugPlaywrightComputer(options, "mouse", {
        method: "move",
        input: { x: action.x, y: action.y }
      });
      await page.mouse.move(action.x, action.y);
      break;
    case "drag":
      debugPlaywrightComputer(options, "mouse", {
        method: "drag",
        start: { x: action.x, y: action.y },
        end: {
          x: action.path?.at(-1)?.x ?? action.x,
          y: action.path?.at(-1)?.y ?? action.y
        }
      });
      await page.mouse.move(action.x, action.y);
      await page.mouse.down();
      await page.mouse.move(action.path?.at(-1)?.x ?? action.x, action.path?.at(-1)?.y ?? action.y);
      await page.mouse.up();
      break;
    default:
      if (typeof options.onUnknownAction === "function") {
        await options.onUnknownAction(action);
      }
  }
}

function debugPlaywrightComputer(options, message, details) {
  writeDebugLogFile(options.logFile, "automify:browser-computer", message, details, { silent: options.silent });
  if (options.silent || !options.debug) return;
  const label = `[automify:browser-computer] ${message}`;
  if (typeof options.debug === "function") {
    options.debug(label, details);
    return;
  }
  console.error(formatBrowserLog(label, details));
}

function formatBrowserLog(label, details) {
  if (!details || typeof details !== "object") return label;
  const parts = [];
  const add = (key, value) => {
    if (value == null || value === "") return;
    parts.push(`${key}=${value}`);
  };

  add("action", describeBrowserAction(details.action));
  add("browser", details.browserName);
  if (details.width && details.height) add("viewport", `${details.width}x${details.height}`);
  if (details.headless != null) add("headless", details.headless);
  add("method", details.method);
  if (details.input)
    add(
      "input",
      Array.isArray(details.input) ? details.input.join("+") : `${details.input.x ?? "?"},${details.input.y ?? "?"}`
    );
  if (details.output)
    add("output", typeof details.output === "string" ? details.output : JSON.stringify(details.output));
  if (details.start) add("start", `${details.start.x ?? "?"},${details.start.y ?? "?"}`);
  if (details.end) add("end", `${details.end.x ?? "?"},${details.end.y ?? "?"}`);
  add("button", details.button);
  add(
    "scroll",
    details.scrollX != null || details.scrollY != null ? `${details.scrollX ?? 0},${details.scrollY ?? 0}` : undefined
  );
  if (details.text != null) add("text", JSON.stringify(String(details.text).slice(0, 80)));
  add("phase", details.phase);
  add("bytes", details.bytes);
  add("durationMs", details.durationMs);
  if (details.url) add("url", JSON.stringify(details.url));

  return parts.length ? `${label} ${parts.join(" ")}` : label;
}

function describeBrowserAction(action) {
  if (!action?.type) return "";
  const parts = [action.type];
  if (action.x != null || action.y != null) parts.push(`@${action.x ?? "?"},${action.y ?? "?"}`);
  if (action.button) parts.push(`button:${action.button}`);
  const keys = action.keys ?? [action.key].filter(Boolean);
  if (keys?.length) parts.push(`keys:${keys.join("+")}`);
  if (action.text != null) parts.push(`text:${JSON.stringify(String(action.text).slice(0, 80))}`);
  if (action.ms != null || action.duration_ms != null) parts.push(`ms:${action.ms ?? action.duration_ms}`);
  if (action.scroll_x != null || action.scroll_y != null)
    parts.push(`scroll:${action.scroll_x ?? 0},${action.scroll_y ?? 0}`);
  if (action.delta_x != null || action.delta_y != null)
    parts.push(`delta:${action.delta_x ?? 0},${action.delta_y ?? 0}`);
  return parts.join(":");
}

function normalizeButton(button) {
  return button === "right" || button === "middle" ? button : "left";
}

function normalizeKey(key) {
  return KEY_ALIASES.get(String(key).toLowerCase()) ?? key;
}

function normalizeKeypress(keys) {
  return keys.map((key) => normalizeKey(key)).join("+");
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new AutomifyError(
      "createBrowserComputer requires the 'playwright' dependency. Reinstall dependencies with: npm install",
      {
        cause: error
      }
    );
  }
}
