import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BrowserAutomify, createBrowserAutomify, withBrowserAutomify } from "../src/index.js";

test("createBrowserAutomify returns an Automify wired to a launched browser", async () => {
  const events = [];
  const completions = [];
  const page = makePage(events);
  const playwright = makePlaywright(events, page);
  const client = {
    async createResponse() {
      return { id: "resp_done", output: [] };
    }
  };

  const automify = await createBrowserAutomify({
    openaiApiKey: "token",
    client,
    model: "test-browser-model",
    playwright,
    url: "https://example.test",
    displayWidth: 900,
    displayHeight: 700,
    headless: true,
    onComplete(event) {
      completions.push(event);
    }
  });

  assert.ok(automify instanceof BrowserAutomify);
  assert.equal(automify.page, page);
  assert.equal(automify.computer.displayWidth, 900);
  assert.equal(automify.computer.displayHeight, 700);

  const result = await automify.do("Summarize page");
  await automify.goto("https://next.test");
  await automify.close();

  assert.equal(result.completed, true);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].completed, true);
  assert.equal(completions[0].surface, "browser");
  assert.deepEqual(events, [
    ["launch", { headless: true }],
    ["newContext", { viewport: { width: 900, height: 700 } }],
    ["newPage"],
    ["goto", "https://example.test", undefined],
    ["goto", "https://next.test", undefined],
    ["close"]
  ]);
});

test("withBrowserAutomify closes the browser after the callback", async () => {
  const events = [];
  const page = makePage(events);
  const playwright = makePlaywright(events, page);

  const value = await withBrowserAutomify(
    {
      openaiApiKey: "token",
      client: {
        async createResponse() {
          return { id: "resp_done", output: [] };
        }
      },
      model: "test-browser-model",
      playwright
    },
    async (automify) => {
      assert.ok(automify instanceof BrowserAutomify);
      return "done";
    }
  );

  assert.equal(value, "done");
  assert.equal(events.at(-1)[0], "close");
});

test("createBrowserAutomify writes run and browser adapter events to logFile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-browser-logs-"));
  const logFile = join(dir, "browser.jsonl");
  const events = [];
  const page = makePage(events);
  const playwright = makePlaywright(events, page);
  const automify = await createBrowserAutomify({
    openaiApiKey: "token",
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-browser-model",
    playwright,
    logFile
  });

  await automify.do("Summarize page");
  await automify.close();

  const logEvents = (await readFile(logFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(logEvents.some((event) => event.scope === "automify" && event.message === "request"));
  assert.ok(logEvents.some((event) => event.scope === "automify:browser-computer" && event.message === "setup_start"));
  assert.ok(
    logEvents.some((event) => event.scope === "automify:browser-computer" && event.message === "setup_complete")
  );
});

function makePlaywright(events, page) {
  return {
    chromium: {
      async launch(options) {
        events.push(["launch", options]);
        return {
          async newContext(options) {
            events.push(["newContext", options]);
            return {
              async newPage() {
                events.push(["newPage"]);
                return page;
              }
            };
          },
          async close() {
            events.push(["close"]);
          }
        };
      }
    }
  };
}

function makePage(events) {
  return {
    viewportSize() {
      return { width: 1024, height: 768 };
    },
    async goto(url, options) {
      events.push(["goto", url, options]);
    },
    async screenshot() {
      return Buffer.from("screenshot");
    },
    url() {
      return "https://example.test";
    },
    mouse: {
      async click() {},
      async dblclick() {},
      async move() {},
      async down() {},
      async up() {}
    },
    keyboard: {
      async press() {},
      async type() {}
    },
    async evaluate() {},
    async waitForTimeout() {}
  };
}
