import assert from "node:assert/strict";
import { test } from "node:test";

import { createBrowserComputer, createPlaywrightComputer, executePlaywrightAction } from "../src/index.js";

test("createBrowserComputer launches a Playwright browser and returns a ready adapter", async () => {
  const events = [];
  const page = makePage(events);
  const context = {
    async newPage() {
      events.push(["newPage"]);
      return page;
    }
  };
  const browser = {
    async newContext(options) {
      events.push(["newContext", options]);
      return context;
    },
    async close() {
      events.push(["close"]);
    }
  };
  const playwright = {
    chromium: {
      async launch(options) {
        events.push(["launch", options]);
        return browser;
      }
    }
  };

  const computer = await createBrowserComputer({
    playwright,
    headless: true,
    url: "https://example.test",
    displayWidth: 1200,
    displayHeight: 800,
    launchOptions: { slowMo: 10 },
    contextOptions: { locale: "en-US" }
  });

  assert.equal(computer.displayWidth, 1200);
  assert.equal(computer.displayHeight, 800);
  assert.equal(computer.environment, "browser");
  assert.equal(computer.page, page);
  assert.equal(computer.context, context);
  assert.equal(computer.browser, browser);
  assert.match(computer.instructions, /Use deterministic browser controls/);
  assert.match(computer.instructions, /Do not click as a probe/);
  assert.match(computer.instructions, /Do not repeat nearly identical clicks/);

  await computer.goto("https://next.example");
  await computer.close();

  assert.deepEqual(events, [
    ["launch", { headless: true, slowMo: 10 }],
    [
      "newContext",
      {
        viewport: { width: 1200, height: 800 },
        locale: "en-US"
      }
    ],
    ["newPage"],
    ["goto", "https://example.test", undefined],
    ["goto", "https://next.example", undefined],
    ["close"]
  ]);
});

test("createBrowserComputer accepts ergonomic browser option aliases", async () => {
  const events = [];
  const page = makePage(events);
  const context = {
    async newPage() {
      events.push(["newPage"]);
      return page;
    }
  };
  const browser = {
    async newContext(options) {
      events.push(["newContext", options]);
      return context;
    },
    async close() {
      events.push(["close"]);
    }
  };
  const playwright = {
    firefox: {
      async launch(options) {
        events.push(["launch", options]);
        return browser;
      }
    }
  };

  const computer = await createBrowserComputer({
    playwright,
    browser: "firefox",
    startUrl: "https://example.test",
    viewport: { width: 1111, height: 777 },
    launch: { slowMo: 5 },
    context: { locale: "it-IT" },
    navigation: { waitUntil: "domcontentloaded" }
  });

  assert.equal(computer.displayWidth, 1111);
  assert.equal(computer.displayHeight, 777);
  assert.deepEqual(events, [
    ["launch", { headless: true, slowMo: 5 }],
    ["newContext", { viewport: { width: 1111, height: 777 }, locale: "it-IT" }],
    ["newPage"],
    ["goto", "https://example.test", { waitUntil: "domcontentloaded" }]
  ]);
});


test("createBrowserComputer launches headless by default", async () => {
  const events = [];
  const page = makePage(events);
  const playwright = {
    chromium: {
      async launch(options) {
        events.push(["launch", options]);
        return {
          async newContext() {
            return {
              async newPage() {
                return page;
              }
            };
          },
          async close() {}
        };
      }
    }
  };

  const computer = await createBrowserComputer({ playwright });
  await computer.close();

  assert.equal(events[0][1].headless, true);
});

test("createBrowserComputer closes the browser when setup fails", async () => {
  const events = [];
  const error = new Error("context failed");
  const playwright = {
    chromium: {
      async launch(options) {
        events.push(["launch", options]);
        return {
          async newContext() {
            events.push(["newContext"]);
            throw error;
          },
          async close() {
            events.push(["close"]);
          }
        };
      }
    }
  };

  await assert.rejects(() => createBrowserComputer({ playwright }), error);

  assert.deepEqual(events, [["launch", { headless: true }], ["newContext"], ["close"]]);
});

test("createPlaywrightComputer executes common browser actions", async () => {
  const events = [];
  const page = makePage(events);
  const computer = createPlaywrightComputer(page, { waitMs: 5 });

  await computer.execute({ type: "click", x: 1, y: 2, button: "right" });
  await computer.execute({ type: "double_click", x: 3, y: 4 });
  await computer.execute({ type: "scroll", x: 5, y: 6, scroll_x: 7, scroll_y: 8 });
  await computer.execute({ type: "keypress", keys: ["Control", "L"] });
  await computer.execute({ type: "type", text: "hello" });
  await computer.execute({ type: "move", x: 9, y: 10 });
  await computer.execute({ type: "wait" });

  assert.deepEqual(events, [
    ["click", 1, 2, { button: "right" }],
    ["dblclick", 3, 4, { button: "left" }],
    ["move", 5, 6],
    ["evaluate", [7, 8]],
    ["press", "Control+L"],
    ["type", "hello"],
    ["move", 9, 10],
    ["waitForTimeout", 5]
  ]);
});

test("executePlaywrightAction delegates unknown actions when a callback exists", async () => {
  const seen = [];
  await executePlaywrightAction(makePage([]), { type: "custom_action" }, { onUnknownAction: (action) => seen.push(action) });

  assert.deepEqual(seen, [{ type: "custom_action" }]);
});

test("executePlaywrightAction sends keypress arrays as combinations", async () => {
  const events = [];

  await executePlaywrightAction(makePage(events), { type: "keypress", keys: ["cmd", "shift", "p"] });

  assert.deepEqual(events, [["press", "Meta+Shift+p"]]);
});

test("executePlaywrightAction emits debug events", async () => {
  const logs = [];

  await executePlaywrightAction(makePage([]), { type: "click", x: 11, y: 22, button: "right" }, {
    debug(message, details) {
      logs.push([message, details]);
    }
  });

  assert.equal(logs[0][0], "[automify:browser-computer] action");
  assert.deepEqual(logs[0][1].action, { type: "click", x: 11, y: 22, button: "right" });
  assert.equal(logs[1][0], "[automify:browser-computer] mouse");
  assert.deepEqual(logs[1][1], {
    method: "click",
    input: { x: 11, y: 22 },
    button: "right"
  });
});

test("executePlaywrightAction defaults debug to false", async () => {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);

  try {
    await executePlaywrightAction(makePage([]), { type: "click", x: 11, y: 22 });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(logs, []);
});

test("executePlaywrightAction can silence logs", async () => {
  const logs = [];

  await executePlaywrightAction(makePage([]), { type: "click", x: 11, y: 22 }, {
    silent: true,
    debug(message, details) {
      logs.push([message, details]);
    }
  });

  assert.deepEqual(logs, []);
});

test("createBrowserComputer validates option names with suggestions", async () => {
  await assert.rejects(
    () => createBrowserComputer({ startURL: "https://example.com" }),
    /Unknown browser adapter option "startURL". Did you mean "startUrl"\?/
  );
});

function makePage(events) {
  return {
    viewportSize() {
      return { width: 1024, height: 768 };
    },
    mouse: {
      async click(x, y, options) {
        events.push(["click", x, y, options]);
      },
      async dblclick(x, y, options) {
        events.push(["dblclick", x, y, options]);
      },
      async move(x, y) {
        events.push(["move", x, y]);
      },
      async down() {
        events.push(["down"]);
      },
      async up() {
        events.push(["up"]);
      }
    },
    keyboard: {
      async press(key) {
        events.push(["press", key]);
      },
      async type(text) {
        events.push(["type", text]);
      }
    },
    async evaluate(_fn, value) {
      events.push(["evaluate", value]);
    },
    async waitForTimeout(ms) {
      events.push(["waitForTimeout", ms]);
    },
    async screenshot(options) {
      events.push(["screenshot", options]);
      return Buffer.from("screenshot");
    },
    async goto(url, options) {
      events.push(["goto", url, options]);
    },
    url() {
      return "https://example.test";
    }
  };
}
