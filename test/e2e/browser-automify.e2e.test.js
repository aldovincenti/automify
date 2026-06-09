import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { createBrowserAutomify, withBrowserAutomify } from "../../src/index.js";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("e2e: browser automify clicks and types into a real page", async () => {
  const fixture = await createFixture();
  const calls = [];
  const client = scriptedClient(calls, [
    { type: "click", x: 180, y: 100 },
    { type: "type", text: "hello from automify" },
    { type: "click", x: 180, y: 160 }
  ]);

  const automify = await createBrowserAutomify({
    openaiApiKey: "test-token",
    client,
    model: "test-browser-model",
    headless: true,
    url: fixture.url,
    displayWidth: 640,
    displayHeight: 480
  });

  try {
    const result = await automify.do("Type the message into the form and submit it.");
    const submittedText = await automify.page.locator("#submitted").textContent();
    const stepText = await automify.page.locator("#steps").textContent();

    assert.equal(result.completed, true);
    assert.equal(result.steps.length, 3);
    assert.equal(submittedText, "hello from automify");
    assert.equal(stepText, "1");
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0].tools[0], {
      type: "computer",
      environment: "browser",
      displayWidth: 640,
      displayHeight: 480
    });
    assert.equal(calls[1].previous_response_id, "resp_0");
    assert.match(calls[1].input[0].output.image_url, /^data:image\/png;base64,/);
  } finally {
    await automify.close();
    await fixture.cleanup();
  }
});

test("e2e: withBrowserAutomify closes the real browser after a scoped run", async () => {
  const fixture = await createFixture();
  let page;
  let browser;

  await withBrowserAutomify(
    {
      openaiApiKey: "test-token",
      client: scriptedClient([], []),
      model: "test-browser-model",
      headless: true,
      url: fixture.url
    },
    async (automify) => {
      page = automify.page;
      browser = automify.browser;
      assert.equal(await page.locator("h1").textContent(), "Automify E2E");
    }
  );

  assert.equal(page.isClosed(), true);
  assert.equal(browser.isConnected(), false);
  await fixture.cleanup();
});

test("e2e: browser automify adds a person on the docs demo page", async () => {
  let automify;
  const calls = [];

  try {
    automify = await createBrowserAutomify({
      openaiApiKey: "test-token",
      model: "test-browser-model",
      headless: true,
      url: pathToFileURL(join(rootDirectory, "docs/demo.html")).href
    });

    const client = scriptedClient(
      calls,
      [
        () => clickCenter(automify.page, "#first-name"),
        { type: "type", text: "Ada" },
        () => clickCenter(automify.page, "#last-name"),
        { type: "type", text: "Lovelace" },
        () => clickCenter(automify.page, "#person-form button")
      ],
      async () => {
        return automify.page.locator("#latest-record-json").textContent();
      }
    );
    automify.client = client;

    const result = await automify.do("Add the person from data, then read the latest saved record JSON.", {
      data: { firstName: "Ada", lastName: "Lovelace" }
    });
    const record = JSON.parse(await automify.page.locator("#latest-record-json").textContent());

    assert.equal(record.firstName, "Ada");
    assert.equal(record.lastName, "Lovelace");
    assert.match(record.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.match(result.text, new RegExp(record.id));
    assert.equal(calls.length, 6);
  } finally {
    await automify?.close();
  }
});

test("e2e: browser task builder adds a person on the docs demo page", async () => {
  let automify;
  const calls = [];

  try {
    automify = await createBrowserAutomify({
      openaiApiKey: "test-token",
      model: "test-browser-model",
      headless: true,
      url: pathToFileURL(join(rootDirectory, "docs/demo.html")).href
    });

    const client = scriptedClient(
      calls,
      [
        () => clickCenter(automify.page, "#first-name"),
        { type: "type", text: "Grace" },
        () => clickCenter(automify.page, "#last-name"),
        { type: "type", text: "Hopper" },
        () => clickCenter(automify.page, "#person-form button")
      ],
      async () => {
        return automify.page.locator("#latest-record-json").textContent();
      }
    );
    automify.client = client;

    const result = await automify
      .addStep("Add the person from data.")
      .addWait(50)
      .addExtract("Read the latest saved record JSON.")
      .addData({ firstName: "Grace", lastName: "Hopper" })
      .run();
    const record = JSON.parse(await automify.page.locator("#latest-record-json").textContent());
    const initialInstruction = calls[0].input[0].content[0].text;

    assert.equal(result.completed, true);
    assert.equal(record.firstName, "Grace");
    assert.equal(record.lastName, "Hopper");
    assert.match(result.text, new RegExp(record.id));
    assert.match(initialInstruction, /Follow these steps in order/);
    assert.match(initialInstruction, /Wait for about 50 ms/);
    assert.match(initialInstruction, /"firstName": "Grace"/);
  } finally {
    await automify?.close();
  }
});

test("e2e: browser sequential task builder preserves page state across step runs", async () => {
  let automify;
  const calls = [];

  try {
    automify = await createBrowserAutomify({
      openaiApiKey: "test-token",
      model: "test-browser-model",
      headless: true,
      url: pathToFileURL(join(rootDirectory, "docs/demo.html")).href
    });

    const client = scriptedSequentialClient(calls, [
      {
        actions: [() => clickCenter(automify.page, "#first-name"), { type: "type", text: "Katherine" }]
      },
      {
        actions: [() => clickCenter(automify.page, "#last-name"), { type: "type", text: "Johnson" }]
      },
      {
        actions: [() => clickCenter(automify.page, "#person-form button")]
      },
      {
        finalText: async () => automify.page.locator("#latest-record-json").textContent()
      }
    ]);
    automify.client = client;

    const result = await automify
      .task({ mode: "sequential" })
      .addStep("Fill the first name.")
      .addStep("Fill the last name.")
      .addStep("Submit the form.")
      .addExtract("Read the latest saved record JSON.", {
        key: "record",
        shape: {
          id: "string",
          firstName: "string",
          lastName: "string"
        }
      })
      .run();
    const record = JSON.parse(await automify.page.locator("#latest-record-json").textContent());
    const initialCalls = calls.filter((call) => !call.previous_response_id);

    assert.equal(result.completed, true);
    assert.equal(record.firstName, "Katherine");
    assert.equal(record.lastName, "Johnson");
    assert.equal(result.parsed.record.firstName, "Katherine");
    assert.equal(result.parsed.record.lastName, "Johnson");
    assert.equal(result.taskSteps.length, 4);
    assert.equal(result.steps.length, 5);
    assert.equal(initialCalls.length, 4);
    assert.match(initialCalls[0].input[0].content[0].text, /Complete task step 1 of 4/);
    assert.match(initialCalls[3].input[0].content[0].text, /extract: Read the latest saved record JSON/);
    assert.equal(initialCalls[3].text.format.name, "record");
  } finally {
    await automify?.close();
  }
});

test("e2e: browser automify records a real page run", async () => {
  const fixture = await createFixture();
  const dir = await mkdtemp(join(tmpdir(), "automify-e2e-recording-"));
  const recordingPath = join(dir, "run.mp4");
  const ffmpegCalls = [];
  const automify = await createBrowserAutomify({
    openaiApiKey: "test-token",
    client: scriptedClient([], []),
    model: "test-browser-model",
    headless: true,
    url: fixture.url,
    displayWidth: 640,
    displayHeight: 480
  });

  try {
    const result = await automify.do("Summarize this test page.", {
      recording: {
        path: recordingPath,
        fps: 2,
        captureIntervalMs: 10,
        execFile: async (command, args) => {
          ffmpegCalls.push({ command, args });
          await writeFile(args.at(-1), Buffer.from("video"));
        }
      }
    });
    const video = await readFile(recordingPath);

    assert.equal(result.completed, true);
    assert.equal(result.recording.path, recordingPath);
    assert.equal(result.recording.bytes, video.byteLength);
    assert.ok(result.recording.frames >= 1);
    assert.equal(video.toString(), "video");
    assert.equal(ffmpegCalls.length, 1);
    assert.equal(ffmpegCalls[0].command, "ffmpeg");
  } finally {
    await automify.close();
    await fixture.cleanup();
    await rm(dir, { recursive: true, force: true });
  }
});

function scriptedClient(calls, actions, finalText = "Done") {
  return {
    async createResponse(payload) {
      const index = calls.length;
      calls.push(payload);

      if (index >= actions.length) {
        const text = typeof finalText === "function" ? await finalText() : finalText;
        return {
          id: `resp_${index}`,
          output: [{ type: "message", content: [{ type: "output_text", text }] }]
        };
      }

      const action = typeof actions[index] === "function" ? await actions[index]() : actions[index];

      return {
        id: `resp_${index}`,
        output: [
          {
            type: "computer_call",
            call_id: `call_${index}`,
            action,
            pending_safety_checks: []
          }
        ]
      };
    }
  };
}

function scriptedSequentialClient(calls, runs) {
  let runIndex = -1;
  let actionIndex = 0;

  return {
    async createResponse(payload) {
      if (!payload.previous_response_id) {
        runIndex += 1;
        actionIndex = 0;
      }

      const index = calls.length;
      calls.push(payload);
      const run = runs[runIndex] ?? {};
      const actions = run.actions ?? [];

      if (actionIndex >= actions.length) {
        const finalText = run.finalText ?? "Done";
        const text = typeof finalText === "function" ? await finalText() : finalText;
        return {
          id: `resp_${index}`,
          output: [{ type: "message", content: [{ type: "output_text", text }] }]
        };
      }

      const actionSource = actions[actionIndex];
      const action = typeof actionSource === "function" ? await actionSource() : actionSource;
      actionIndex += 1;

      return {
        id: `resp_${index}`,
        output: [
          {
            type: "computer_call",
            call_id: `call_${index}`,
            action,
            pending_safety_checks: []
          }
        ]
      };
    }
  };
}

async function clickCenter(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `Expected ${selector} to be visible`);
  return {
    type: "click",
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2)
  };
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "automify-e2e-"));
  const file = join(directory, "index.html");

  await writeFile(
    file,
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Automify E2E</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 32px; }
      input, button { box-sizing: border-box; font-size: 16px; height: 40px; left: 40px; padding: 8px; position: absolute; width: 280px; }
      input { top: 80px; }
      button { top: 140px; }
      #submitted { left: 40px; min-height: 24px; position: absolute; top: 200px; }
      #steps { left: 40px; position: absolute; top: 232px; }
    </style>
  </head>
  <body>
    <h1>Automify E2E</h1>
    <input id="message" aria-label="Message" />
    <button id="submit" type="button">Submit</button>
    <output id="submitted"></output>
    <output id="steps">0</output>
    <script>
      document.querySelector("#submit").addEventListener("click", () => {
        document.querySelector("#submitted").textContent = document.querySelector("#message").value;
        document.querySelector("#steps").textContent = String(Number(document.querySelector("#steps").textContent) + 1);
      });
    </script>
  </body>
</html>
`,
    "utf8"
  );

  return {
    directory,
    url: pathToFileURL(file).href,
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
