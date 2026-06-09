import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAutomify, MaxStepsExceededError, SafetyCheckError } from "../src/index.js";

test("do sends an initial Responses computer-use request and executes returned actions", async () => {
  const calls = [];
  const actions = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);

      if (calls.length === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              action: { type: "click", x: 10, y: 20, button: "left" },
              pending_safety_checks: []
            }
          ]
        };
      }

      return {
        id: "resp_2",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };

  const computer = {
    displayWidth: 800,
    displayHeight: 600,
    environment: "browser",
    execute(action) {
      actions.push(action);
    },
    screenshot() {
      return Buffer.from("fake-png");
    },
    currentUrl() {
      return "https://example.test";
    }
  };

  const automify = createAutomify({ client, computer, model: "test-computer-model" });
  const result = await automify.do("Click the button", { data: { id: "submit" } });

  assert.equal(result.ok, true);
  assert.equal(result.status, "succeeded");
  assert.equal(result.completed, true);
  assert.equal(result.steps.length, 1);
  assert.equal(result.text, "Done");
  assert.deepEqual(actions, [{ type: "click", x: 10, y: 20, button: "left" }]);
  assert.equal(calls[0].model, "test-computer-model");
  assert.equal(calls[0].truncation, "auto");
  assert.deepEqual(calls[0].tools, [
    {
      type: "computer",
      environment: "browser",
      displayWidth: 800,
      displayHeight: 600
    }
  ]);
  assert.match(calls[0].input[0].content[0].text, /Click the button/);
  assert.match(calls[0].input[0].content[0].text, /"id": "submit"/);

  assert.equal(calls[1].previous_response_id, "resp_1");
  assert.equal(calls[1].input[0].call_id, "call_1");
  assert.equal(calls[1].input[0].current_url, undefined);
  assert.equal(calls[1].input[0].output.type, "computer_screenshot");
  assert.equal(
    calls[1].input[0].output.image_url,
    `data:image/png;base64,${Buffer.from("fake-png").toString("base64")}`
  );
  assert.equal(calls[1].input[0].output.detail, "auto");
});

test("task builder composes ordered step instructions and delegates to do", async () => {
  const calls = [];
  const automify = createAutomify({
    client: {
      async createResponse(payload) {
        calls.push(payload);
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-computer-model",
    computer: {
      displayWidth: 800,
      displayHeight: 600,
      environment: "browser",
      execute() {},
      screenshot() {
        return Buffer.from("fake-png");
      }
    }
  });

  const result = await automify
    .addStep("Open the contacts page.")
    .addWait("the contacts table is visible")
    .addStep("Return the first contact.", { label: "read" })
    .addData({ accountId: "acct_123" })
    .run();

  const text = calls[0].input[0].content[0].text;
  assert.equal(result.completed, true);
  assert.match(text, /Follow these steps in order/);
  assert.match(text, /1\. Open the contacts page\./);
  assert.match(text, /2\. wait: Wait until the contacts table is visible\./);
  assert.match(text, /3\. \[read\] Return the first contact\./);
  assert.match(text, /"accountId": "acct_123"/);
});

test("Automify writes computer run events to logFile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-computer-logs-"));
  const logFile = join(dir, "computer.jsonl");
  const client = {
    async createResponse(payload) {
      if (!payload.previous_response_id) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              action: { type: "click", x: 10, y: 20, button: "left" },
              pending_safety_checks: []
            }
          ]
        };
      }

      return { id: "resp_2", output: [] };
    }
  };
  const automify = createAutomify({
    client,
    model: "test-computer-model",
    logFile,
    computer: {
      displayWidth: 800,
      displayHeight: 600,
      environment: "browser",
      execute() {},
      screenshot() {
        return Buffer.from("fake-png");
      }
    }
  });

  await automify.do("Click the button");

  const events = (await readFile(logFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.scope === "automify" && event.message === "request"));
  assert.ok(events.some((event) => event.scope === "automify" && event.message === "action_executed"));
  assert.ok(events.some((event) => event.scope === "automify" && event.message === "complete"));
});

test("do includes filesToEvaluate content in the initial computer request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-computer-evaluate-"));
  const imagePath = join(dir, "screen.png");
  await writeFile(imagePath, Buffer.from("fake-png"));
  const calls = [];
  const automify = createAutomify({
    client: {
      async createResponse(payload) {
        calls.push(payload);
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-computer-model",
    computer: {
      displayWidth: 800,
      displayHeight: 600,
      environment: "linux",
      execute() {},
      screenshot() {
        return Buffer.from("fake-png");
      }
    }
  });

  await automify.do("Evaluate the supplied screenshot.", {
    filesToEvaluate: [imagePath]
  });

  assert.equal(calls[0].input[0].content[1].type, "input_image");
  assert.match(calls[0].input[0].content[1].image_url, /^data:image\/png;base64,/);
});

test("do lets run options override computer tool metadata", async () => {
  const calls = [];
  const automify = createAutomify({
    client: {
      async createResponse(payload) {
        calls.push(payload);
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-computer-model",
    computer: {
      displayWidth: 800,
      displayHeight: 600,
      environment: "linux",
      execute() {},
      screenshot() {
        return Buffer.from("fake-png");
      }
    }
  });

  await automify.do("Inspect the remote screen.", {
    environment: "windows",
    displayWidth: 1024,
    displayHeight: 768
  });

  assert.deepEqual(calls[0].tools, [
    {
      type: "computer",
      environment: "windows",
      displayWidth: 1024,
      displayHeight: 768
    }
  ]);
});

test("do allows screenshot detail to be tuned", async () => {
  const calls = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);
      if (calls.length === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              action: { type: "screenshot" },
              pending_safety_checks: []
            }
          ]
        };
      }

      return {
        id: "resp_2",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };
  const computer = {
    execute() {},
    screenshot() {
      return Buffer.from("fake-png");
    }
  };

  const dir = await mkdtemp(join(tmpdir(), "automify-detail-"));
  try {
    await createAutomify({ client, computer, model: "test-computer-model", screenshotDetail: "low" }).do("Look", {
      initialScreenshot: join(dir, "initial.png")
    });

    assert.equal(calls[0].input[0].content[1].detail, "low");
    assert.equal(calls[1].input[0].output.detail, "low");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("do resizes screenshots and maps model coordinates back to the adapter space", async () => {
  const calls = [];
  const actions = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);
      if (calls.length === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              action: { type: "click", x: 720, y: 360, button: "left" },
              pending_safety_checks: []
            }
          ]
        };
      }

      return {
        id: "resp_2",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };
  const computer = {
    execute(action) {
      actions.push(action);
    },
    screenshot() {
      return pngHeader(2880, 1440);
    }
  };

  const dir = await mkdtemp(join(tmpdir(), "automify-resize-"));
  try {
    const result = await createAutomify({
      client,
      computer,
      model: "test-computer-model",
      screenshotResize: (_screenshot, target) => pngHeader(target.width, target.height),
      trace: true
    }).do("Click center", {
      initialScreenshot: join(dir, "initial.png")
    });

    assert.deepEqual(actions, [{ type: "click", x: 1440, y: 720, button: "left" }]);
    assert.deepEqual(result.steps[0].executedActions, [{ type: "click", x: 1440, y: 720, button: "left" }]);
    assert.equal(
      calls[0].input[0].content[1].image_url,
      `data:image/png;base64,${pngHeader(1440, 720).toString("base64")}`
    );
    assert.equal(
      calls[1].input[0].output.image_url,
      `data:image/png;base64,${pngHeader(1440, 720).toString("base64")}`
    );
    assert.ok(result.trace.some((event) => event.type === "screenshot" && event.resized === true));
    assert.ok(result.trace.some((event) => event.type === "action" && event.coordinateTransform.scaleX === 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("do reuses the initial screenshot for an immediate screenshot action", async () => {
  const client = {
    calls: 0,
    async createResponse() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              action: { type: "screenshot" },
              pending_safety_checks: []
            }
          ]
        };
      }

      return {
        id: "resp_2",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };
  let screenshots = 0;
  const computer = {
    execute() {},
    screenshot() {
      screenshots += 1;
      return pngHeader(800, 600);
    }
  };

  const dir = await mkdtemp(join(tmpdir(), "automify-reuse-"));
  try {
    const result = await createAutomify({ client, computer, model: "test-computer-model", trace: true }).do("Look", {
      initialScreenshot: join(dir, "initial.png")
    });

    assert.equal(screenshots, 1);
    assert.ok(result.trace.some((event) => event.type === "screenshot" && event.reused === true));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("do can send an initial screenshot without writing it to disk", async () => {
  const calls = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);
      return {
        id: "resp_done",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };
  let screenshots = 0;
  const computer = {
    execute() {},
    screenshot(context) {
      screenshots += 1;
      assert.equal(context.initial, true);
      return pngHeader(800, 600);
    }
  };

  await createAutomify({ client, computer, model: "test-computer-model", sendInitialScreenshot: true }).do("Look");

  assert.equal(screenshots, 1);
  assert.equal(calls[0].input[0].content[1].type, "input_image");
  assert.equal(
    calls[0].input[0].content[1].image_url,
    `data:image/png;base64,${pngHeader(800, 600).toString("base64")}`
  );
});

test("do saves a final screenshot before returning the result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-final-screenshot-"));
  const finalScreenshot = join(dir, "final.png");
  const contexts = [];
  const client = {
    calls: 0,
    async createResponse() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              action: { type: "click", x: 10, y: 20, button: "left" },
              pending_safety_checks: []
            }
          ]
        };
      }

      return {
        id: "resp_2",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };
  const computer = {
    execute() {},
    screenshot(context) {
      contexts.push(context);
      return Buffer.from(context?.final ? "final-png" : "step-png");
    }
  };

  try {
    const result = await createAutomify({
      client,
      computer,
      model: "test-computer-model",
      trace: true
    }).do("Click then report", {
      finalScreenshot
    });

    assert.equal((await readFile(finalScreenshot)).toString(), "final-png");
    assert.deepEqual(result.finalScreenshot, {
      path: finalScreenshot,
      bytes: Buffer.byteLength("final-png")
    });
    assert.equal(contexts.at(-1).final, true);
    assert.equal(contexts.at(-1).response.id, "resp_2");
    assert.equal(contexts.at(-1).steps.length, 1);
    assert.ok(
      result.trace.some(
        (event) => event.type === "screenshot" && event.phase === "final" && event.path === finalScreenshot
      )
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("do saves before and after screenshots for every computer action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-action-screenshots-"));
  const contexts = [];
  const client = {
    calls: 0,
    async createResponse() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              actions: [
                { type: "click", x: 10, y: 20, button: "left" },
                { type: "type", text: "Ada" }
              ],
              pending_safety_checks: []
            }
          ]
        };
      }

      return {
        id: "resp_2",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };
  const computer = {
    execute() {},
    screenshot(context) {
      contexts.push(context);
      if (context?.actionScreenshot) {
        return `${context.phase}-${context.step}-${context.actionIndex}-${context.action.type}`;
      }
      return "model-screenshot";
    }
  };

  try {
    const result = await createAutomify({
      client,
      computer,
      model: "test-computer-model",
      trace: true
    }).do("Fill the form", {
      actionScreenshots: dir
    });

    assert.equal((await readFile(join(dir, "step-0000-action-0000-before-click.png"))).toString(), "before-0-0-click");
    assert.equal((await readFile(join(dir, "step-0000-action-0000-after-click.png"))).toString(), "after-0-0-click");
    assert.equal((await readFile(join(dir, "step-0000-action-0001-before-type.png"))).toString(), "before-0-1-type");
    assert.equal((await readFile(join(dir, "step-0000-action-0001-after-type.png"))).toString(), "after-0-1-type");
    assert.equal(result.steps[0].actionScreenshots.length, 2);
    assert.ok(contexts.some((context) => context.actionScreenshot && context.phase === "before"));
    assert.ok(result.trace.some((event) => event.type === "screenshot" && event.phase === "action_after"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("do uses the configured default final screenshot path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-default-final-screenshot-"));
  const finalScreenshot = join(dir, "final.png");
  const client = {
    async createResponse() {
      return {
        id: "resp_done",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };
  const computer = {
    execute() {},
    screenshot(context) {
      return `data:image/png;base64,${Buffer.from(context?.final ? "default-final" : "not-final").toString("base64")}`;
    }
  };

  try {
    const result = await createAutomify({
      client,
      computer,
      model: "test-computer-model",
      finalScreenshot
    }).do("Report status");

    assert.equal((await readFile(finalScreenshot)).toString(), "default-final");
    assert.deepEqual(result.finalScreenshot, {
      path: finalScreenshot,
      bytes: Buffer.byteLength("default-final")
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("do includes computer adapter instructions in the initial request", async () => {
  const calls = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);
      return {
        id: "resp_done",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };
  const computer = {
    instructions: "Use Spotlight instead of the Dock.",
    execute() {},
    screenshot() {
      return Buffer.from("screen");
    }
  };

  await createAutomify({ client, computer, model: "test-computer-model" }).do("Open Chrome");

  assert.match(calls[0].input[0].content[0].text, /Use Spotlight instead of the Dock/);
  assert.match(calls[0].input[0].content[0].text, /Task:\nOpen Chrome/);
});

test("do supports structured json output and parses the final response", async () => {
  const calls = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);
      if (calls.length === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              action: { type: "wait" },
              pending_safety_checks: []
            }
          ]
        };
      }

      return {
        id: "resp_done",
        output: [{ type: "message", content: [{ type: "output_text", text: '{"email":"support@example.com"}' }] }]
      };
    }
  };
  const computer = {
    execute() {},
    screenshot() {
      return Buffer.from("screen");
    }
  };

  const automify = createAutomify({ client, computer, model: "test-computer-model" });
  const result = await automify.do("Return support email as JSON", {
    output: {
      type: "json_schema",
      name: "support_contact",
      schema: {
        type: "object",
        properties: {
          email: { type: "string" }
        },
        required: ["email"],
        additionalProperties: false
      },
      strict: true
    }
  });

  assert.deepEqual(calls[0].text, {
    format: {
      type: "json_schema",
      name: "support_contact",
      schema: {
        type: "object",
        properties: {
          email: { type: "string" }
        },
        required: ["email"],
        additionalProperties: false
      },
      strict: true
    }
  });
  assert.equal(calls[1].previous_response_id, "resp_1");
  assert.equal(calls[1].text.format.type, "json_schema");
  assert.deepEqual(result.parsed, { email: "support@example.com" });
  assert.equal(result.text, '{"email":"support@example.com"}');
  assert.equal(result.ok, true);
});

test("do executes GA computer action batches", async () => {
  const calls = [];
  const actions = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);
      if (calls.length === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              actions: [
                { type: "click", x: 10, y: 20, button: "left" },
                { type: "type", text: "Ada" }
              ],
              pending_safety_checks: []
            }
          ]
        };
      }

      return {
        id: "resp_done",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      };
    }
  };
  const computer = {
    execute(action) {
      actions.push(action);
    },
    screenshot() {
      return Buffer.from("screen");
    }
  };

  const automify = createAutomify({ client, computer, model: "gpt-5.5" });
  const result = await automify.do("Fill the form");

  assert.deepEqual(actions, [
    { type: "click", x: 10, y: 20, button: "left" },
    { type: "type", text: "Ada" }
  ]);
  assert.equal(result.steps[0].actions.length, 2);
});

test("do accepts a run object when no data is needed", async () => {
  const calls = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);
      return { id: "resp_done", output: [] };
    }
  };
  const computer = {
    execute() {},
    screenshot() {
      return Buffer.from("screen");
    }
  };

  const automify = createAutomify({ client, computer, model: "test-computer-model" });
  await automify.do("Return support email as JSON", {
    output: {
      type: "json_schema",
      name: "support_contact",
      schema: {
        type: "object",
        properties: {
          email: { type: "string" }
        },
        required: ["email"],
        additionalProperties: false
      }
    }
  });

  assert.equal(calls[0].input[0].content[0].text, "Return support email as JSON");
  assert.equal(calls[0].text.format.type, "json_schema");
});

test("do rejects legacy top-level data and third-argument options", async () => {
  const automify = createAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    computer: {
      execute() {},
      screenshot() {
        return Buffer.from("screen");
      }
    },
    model: "test-computer-model"
  });

  await assert.rejects(() => automify.do("Click the button", { id: "submit" }), /Put input values under data/);
  await assert.rejects(
    () => automify.do("Click the button", {}, { model: "test-computer-model" }),
    /single run object/
  );
});

test("do enforces allowedDomains and emits observability hooks", async () => {
  const events = [];
  const client = {
    async createResponse(payload) {
      if (!payload.previous_response_id) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              action: { type: "wait" },
              pending_safety_checks: []
            }
          ]
        };
      }

      return { id: "resp_2", output: [] };
    }
  };
  const computer = {
    execute() {},
    screenshot() {
      return Buffer.from("screen");
    },
    currentUrl() {
      return "https://app.example.com/page";
    }
  };
  const automify = createAutomify({
    client,
    computer,
    model: "test-computer-model",
    allowedDomains: ["example.com"],
    onRequest: (_payload, meta) => events.push(`request:${meta.phase}`),
    onResponse: (_response, meta) => events.push(`response:${meta.phase}`),
    onStep: (event) => events.push(`step:${event.phase}`)
  });

  await automify.do("Wait");

  assert.deepEqual(events, [
    "request:initial",
    "response:initial",
    "step:before_action",
    "step:after_action",
    "request:continue",
    "response:continue"
  ]);
});

test("do includes allowed domain guidance in the initial computer request", async () => {
  const calls = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);
      return { id: "resp_done", output: [] };
    }
  };
  const computer = {
    execute() {},
    screenshot() {
      return Buffer.from("screen");
    },
    currentUrl() {
      return "https://app.example.com/page";
    }
  };

  await createAutomify({
    client,
    computer,
    model: "test-computer-model",
    allowedDomains: ["example.com", /^internal\.test$/]
  }).do("Open the dashboard");

  const text = calls[0].input[0].content[0].text;
  assert.match(text, /Navigation policy:/);
  assert.match(text, /"example.com" \(domain and subdomains\)/);
  assert.match(text, /\/\^internal\\\.test\$\//);
  assert.match(text, /Do not navigate to other domains/);
});

test("do rejects navigation outside allowedDomains", async () => {
  const client = {
    async createResponse() {
      return { id: "resp_done", output: [] };
    }
  };
  const computer = {
    execute() {},
    screenshot() {
      return Buffer.from("screen");
    },
    currentUrl() {
      return "https://evil.example";
    }
  };
  const automify = createAutomify({
    client,
    computer,
    model: "test-computer-model",
    allowedDomains: ["example.com"]
  });

  await assert.rejects(() => automify.do("Do anything"), /not allowed/);
});

test("do throws on pending safety checks unless a callback acknowledges them", async () => {
  const check = { id: "safe_1", code: "sensitive_domain", message: "Confirm monitoring." };
  const client = {
    async createResponse() {
      return {
        id: "resp_1",
        output: [
          {
            type: "computer_call",
            call_id: "call_1",
            action: { type: "click", x: 1, y: 2 },
            pending_safety_checks: [check]
          }
        ]
      };
    }
  };

  const computer = {
    execute() {},
    screenshot() {
      return Buffer.from("fake-png");
    }
  };

  const automify = createAutomify({ client, computer, model: "test-computer-model", maxSteps: 1 });

  await assert.rejects(() => automify.do("Proceed"), SafetyCheckError);
});

test("do includes acknowledged safety checks after callback approval", async () => {
  const check = { id: "safe_1", code: "irrelevant_domain", message: "Confirm relevance." };
  const calls = [];
  const client = {
    async createResponse(payload) {
      calls.push(payload);

      if (calls.length === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "computer_call",
              call_id: "call_1",
              action: { type: "wait" },
              pending_safety_checks: [check]
            }
          ]
        };
      }

      return { id: "resp_2", output: [] };
    }
  };

  const computer = {
    execute() {},
    screenshot() {
      return "ZmFrZS1wbmc=";
    }
  };

  const automify = createAutomify({ client, computer, model: "test-computer-model" });
  await automify.do("Wait", { onSafetyCheck: () => true });

  assert.deepEqual(calls[1].input[0].acknowledged_safety_checks, [check]);
});

test("do enforces maxSteps", async () => {
  const client = {
    async createResponse() {
      return {
        id: "resp_loop",
        output: [
          {
            type: "computer_call",
            call_id: "call_loop",
            action: { type: "wait" },
            pending_safety_checks: []
          }
        ]
      };
    }
  };

  const computer = {
    execute() {},
    screenshot() {
      return Buffer.from("fake-png");
    }
  };

  const automify = createAutomify({ client, computer, model: "test-computer-model", maxSteps: 2 });

  await assert.rejects(() => automify.do("Loop"), MaxStepsExceededError);
});

test("do defaults to a bounded 100 step limit", async () => {
  const client = {
    async createResponse() {
      return {
        id: "resp_loop",
        output: [
          {
            type: "computer_call",
            call_id: "call_loop",
            action: { type: "wait" },
            pending_safety_checks: []
          }
        ]
      };
    }
  };

  const computer = {
    execute() {},
    screenshot() {
      return Buffer.from("fake-png");
    }
  };

  const automify = createAutomify({ client, computer, model: "test-computer-model" });

  await assert.rejects(
    () => automify.do("Keep going"),
    (error) => error instanceof MaxStepsExceededError && error.maxSteps === 100
  );
});

test("constructor requires an OpenAI API key when no custom client is provided", () => {
  assert.throws(
    () =>
      createAutomify({
        computer: {
          execute() {},
          screenshot() {
            return Buffer.from("fake-png");
          }
        }
      }),
    /openaiApiKey/
  );
});

test("do requires an explicit model", async () => {
  const automify = createAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    computer: {
      execute() {},
      screenshot() {
        return Buffer.from("screen");
      }
    }
  });

  await assert.rejects(() => automify.do("Say done"), /model is required/);
  await assert.doesNotReject(() => automify.do("Say done", { model: "per-call-model" }));
});

test("do resolves and emits completion callbacks with input data", async () => {
  const completions = [];
  const client = {
    async createResponse() {
      return { id: "resp_done", output: [] };
    }
  };
  const automify = createAutomify({
    client,
    model: "test-computer-model",
    computer: {
      environment: "browser",
      execute() {},
      screenshot() {
        return Buffer.from("screen");
      }
    },
    onComplete: (event) => completions.push(["global", event])
  });

  const result = await automify.do("Confirm the lead is inserted", {
    data: { leadId: "lead_1" },
    onComplete: (event) => completions.push(["run", event])
  });

  assert.equal(result.completed, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, "succeeded");
  assert.equal(completions.length, 2);
  assert.equal(completions[0][1].instruction, "Confirm the lead is inserted");
  assert.deepEqual(completions[0][1].data, { leadId: "lead_1" });
  assert.equal(completions[0][1].completed, true);
  assert.equal(completions[0][1].ok, true);
  assert.equal(completions[0][1].status, "succeeded");
  assert.equal(completions[0][1].surface, "browser");
  assert.equal(completions[1][1].result, result);
});

test("do can silence computer runner logs", async () => {
  const logs = [];
  const automify = createAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-computer-model",
    silent: true,
    debug(message, details) {
      logs.push([message, details]);
    },
    computer: {
      execute() {},
      screenshot() {
        return Buffer.from("screen");
      }
    }
  });

  await automify.do("Say done");

  assert.deepEqual(logs, []);
});

test("do restores per-run silent override after computer errors", async () => {
  const automify = createAutomify({
    client: {
      async createResponse() {
        throw new Error("request failed");
      }
    },
    model: "test-computer-model",
    silent: false,
    computer: {
      execute() {},
      screenshot() {
        return Buffer.from("screen");
      }
    }
  });

  await assert.rejects(() => automify.do("Fail", { silent: true }), /request failed/);

  assert.equal(automify.silent, false);
});

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  buffer[0] = 0x89;
  buffer[1] = 0x50;
  buffer[2] = 0x4e;
  buffer[3] = 0x47;
  buffer[4] = 0x0d;
  buffer[5] = 0x0a;
  buffer[6] = 0x1a;
  buffer[7] = 0x0a;
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}
