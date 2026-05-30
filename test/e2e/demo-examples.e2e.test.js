import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

import { createVirtualDesktopComputer, filesToData, initAutomify, jsonOutput } from "../../src/index.js";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("e2e demo: virtual desktop example runs through initAutomify.computer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-demo-virtual-desktop-"));
  const finalScreenshot = join(dir, "final.png");
  const dockerCalls = [];
  const computer = await createVirtualDesktopComputer({
    containerName: "automify-demo-virtual-desktop",
    startupCommand: "chromium --no-sandbox",
    execFile: fakeDockerDesktopExec(dockerCalls)
  });
  const modelCalls = [];
  const automify = initAutomify({
    provider: {
      type: "custom",
      model: "test-demo-model",
      client: computerClient(modelCalls, [], () => "Homepage content: Automify demo page.")
    },
    silent: true
  });

  try {
    const desktop = automify.computer({ computer });
    const result = await desktop.do("Go to url and describe the content of the homepage.", {
      data: { url: "https://www.aldovincenti.com" },
      finalScreenshot,
      maxSteps: 4
    });
    const finalScreenshotBytes = await readFile(finalScreenshot);

    assert.equal(result.completed, true);
    assert.match(result.text, /Automify demo page/);
    assertPng(finalScreenshotBytes);
    assert.ok(modelCalls[0].input[0].content.some((part) => part.text?.includes("https://www.aldovincenti.com")));
    assert.ok(dockerCalls.some((call) => call.args[0] === "run"));
    assert.ok(dockerCalls.some((call) => call.args.some((arg) => String(arg).includes("chromium --no-sandbox"))));
  } finally {
    await computer.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("e2e demo: browser example adds a person and returns structured output", async () => {
  let browser;
  const modelCalls = [];
  const automify = initAutomify({
    provider: {
      type: "custom",
      model: "test-demo-model",
      client: {
        async createResponse(payload) {
          const index = modelCalls.length;
          modelCalls.push(payload);

          if (index >= 5) {
            const record = JSON.parse(await browser.page.locator("#latest-record-json").textContent());
            return messageResponse(`resp_${index}`, JSON.stringify(record));
          }

          const actions = [
            () => clickCenter(browser.page, "#first-name"),
            { type: "type", text: "Ada" },
            () => clickCenter(browser.page, "#last-name"),
            { type: "type", text: "Lovelace" },
            () => clickCenter(browser.page, "#person-form button")
          ];
          const action = typeof actions[index] === "function" ? await actions[index]() : actions[index];
          return computerCallResponse(index, action);
        }
      }
    },
    silent: true
  });

  try {
    browser = await automify.browser({
      startUrl: pathToFileURL(join(rootDirectory, "docs/demo.html")).href,
      headless: true
    });

    const run = await browser.do("Add this person and return the saved record.", {
      data: { firstName: "Ada", lastName: "Lovelace" },
      output: jsonOutput("person_record", {
        id: "string",
        firstName: "string",
        lastName: "string"
      })
    });

    assert.equal(run.completed, true);
    assert.equal(run.parsed.firstName, "Ada");
    assert.equal(run.parsed.lastName, "Lovelace");
    assert.match(run.parsed.id, /^[0-9a-f-]{36}$/i);
    assert.equal(modelCalls.length, 6);
  } finally {
    await browser?.close();
  }
});

test("e2e demo: CLI example runs npm test command through the command policy", async () => {
  const runnerCalls = [];
  const automify = initAutomify({
    provider: {
      type: "custom",
      model: "test-demo-model",
      client: cliClient(runnerCalls, "npm test", (output) =>
        JSON.stringify({
          passed: output.exitCode === 0,
          summary: output.stdout.trim()
        })
      )
    },
    silent: true
  });
  const cli = automify.cli({
    logFile: join(tmpdir(), `automify-demo-cli-${Date.now()}.jsonl`),
    command: {
      cwd: rootDirectory,
      allow: ["npm test"]
    },
    runner: async (command) => {
      runnerCalls.push(command);
      return {
        command,
        cwd: rootDirectory,
        exitCode: 0,
        stdout: "all tests passed\n",
        stderr: "",
        timedOut: false
      };
    }
  });

  const run = await cli.do("Run tests.", {
    output: jsonOutput("test_result", {
      passed: "boolean",
      summary: "string"
    })
  });

  assert.deepEqual(runnerCalls, ["npm test"]);
  assert.equal(run.parsed.passed, true);
  assert.equal(run.parsed.summary, "all tests passed");
});

test("e2e demo: Docker CLI example shares data files and updates summary JSON", async () => {
  const sharedDir = await mkdtemp(join(tmpdir(), "automify-demo-docker-cli-"));
  const dataDir = join(sharedDir, "data");
  const reportPath = join(dataDir, "report.csv");
  const summaryPath = join(dataDir, "summary.json");
  const runnerCalls = [];
  const automify = initAutomify({
    provider: {
      type: "custom",
      model: "test-demo-model",
      client: cliClient(runnerCalls, "node scripts/summarize-report.js", () =>
        JSON.stringify({
          topRegion: "North",
          totalRevenue: 4460,
          outputFile: "data/summary.json",
          summary: "North leads with 3480 revenue."
        })
      )
    },
    silent: true
  });

  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      reportPath,
      "region,customer,revenue\n" + "North,Ada Corp,1250\n" + "South,Byron Ltd,980\n" + "North,Lovelace Labs,2230\n"
    );
    await writeFile(summaryPath, "{}\n");

    const cli = automify.dockerCli({
      additionalAptPackages: ["coreutils", "nodejs"],
      shared: { hostPath: sharedDir, containerPath: "/workspace" },
      runner: async (command) => {
        runnerCalls.push(command);
        const summary = {
          byRegion: {
            North: 3480,
            South: 980
          },
          topRegion: "North",
          totalRevenue: 4460
        };
        await writeFile(summaryPath, `${JSON.stringify(summary)}\n`);
        return {
          command,
          cwd: "/workspace",
          exitCode: 0,
          stdout: JSON.stringify(summary),
          stderr: "",
          timedOut: false
        };
      }
    });

    try {
      const run = await cli.do(
        "Read data/report.csv, use a Node.js script to calculate revenue by region, update data/summary.json with the result, and return the top region.",
        {
          data: {
            files: await filesToData(reportPath, { format: "metadata" })
          },
          output: jsonOutput("report_summary", {
            topRegion: "string",
            totalRevenue: "number",
            outputFile: "string",
            summary: "string"
          })
        }
      );
      const summaryFile = JSON.parse(await readFile(summaryPath, "utf8"));

      assert.deepEqual(runnerCalls, ["node scripts/summarize-report.js"]);
      assert.equal(run.parsed.topRegion, "North");
      assert.equal(run.parsed.totalRevenue, 4460);
      assert.equal(run.parsed.outputFile, "data/summary.json");
      assert.equal(summaryFile.byRegion.North, 3480);
      assert.equal(summaryFile.byRegion.South, 980);
      assert.equal(cli.sharedFolder.containerPath, "/workspace");
    } finally {
      await cli.close();
    }
  } finally {
    await rm(sharedDir, { recursive: true, force: true });
  }
});

test("e2e demo: Docker desktop example accepts nested desktop startup options", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-demo-docker-desktop-"));
  const finalScreenshot = join(dir, "final.png");
  const dockerCalls = [];
  const modelCalls = [];
  const automify = initAutomify({
    provider: {
      type: "custom",
      model: "test-demo-model",
      client: computerClient(modelCalls, [{ type: "keypress", keys: ["Enter"] }], () =>
        JSON.stringify({
          kernelName: "Linux",
          machine: "x86_64",
          summary: "The terminal reported Linux on x86_64."
        })
      )
    },
    silent: true
  });
  const desktop = await automify.dockerComputer({
    desktop: {
      startupCommand: "xterm"
    },
    containerName: "automify-demo-docker-desktop",
    execFile: fakeDockerDesktopExec(dockerCalls)
  });

  try {
    const run = await desktop.do(
      "Use the open terminal to run 'uname -a', then return the kernel name and machine architecture shown on screen.",
      {
        finalScreenshot,
        output: jsonOutput("system_info", {
          kernelName: "string",
          machine: "string",
          summary: "string"
        })
      }
    );
    const finalScreenshotBytes = await readFile(finalScreenshot);
    const runArgs = dockerCalls.find((call) => call.args[0] === "run")?.args ?? [];

    assert.equal(run.parsed.kernelName, "Linux");
    assert.equal(run.parsed.machine, "x86_64");
    assertPng(finalScreenshotBytes);
    assert.ok(runArgs.some((arg) => String(arg).includes("xterm")));
    assert.ok(dockerCalls.some((call) => call.args.includes("xdotool") && call.args.includes("key")));
  } finally {
    await desktop.close();
    await rm(dir, { recursive: true, force: true });
  }
});

function cliClient(_runnerCalls, command, finalTextForOutput) {
  const calls = [];
  return {
    async createResponse(payload) {
      calls.push(payload);

      if (calls.length === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "function_call",
              name: "run_command",
              call_id: "call_1",
              arguments: JSON.stringify({ command, cwd: null, timeoutMs: null })
            }
          ]
        };
      }

      const output = JSON.parse(payload.input[0].output);
      return messageResponse("resp_done", finalTextForOutput(output));
    }
  };
}

function computerClient(calls, actions, finalText) {
  return {
    async createResponse(payload) {
      const index = calls.length;
      calls.push(payload);

      if (index >= actions.length) {
        const text = typeof finalText === "function" ? finalText() : finalText;
        return messageResponse(`resp_${index}`, text);
      }

      return computerCallResponse(index, actions[index]);
    }
  };
}

function messageResponse(id, text) {
  return {
    id,
    output: [{ type: "message", content: [{ type: "output_text", text }] }]
  };
}

function computerCallResponse(index, action) {
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

async function clickCenter(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `Expected ${selector} to be visible`);
  return {
    type: "click",
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2)
  };
}

function fakeDockerDesktopExec(calls) {
  return async (command, args, options) => {
    calls.push({ command, args, options });

    if (args[0] === "run") {
      return { stdout: Buffer.from("container-id") };
    }
    if (args[0] === "rm") {
      return { stdout: Buffer.from("") };
    }
    if (args.includes("xdpyinfo >/dev/null 2>&1")) {
      return { stdout: Buffer.from("") };
    }
    if (args.includes("scrot -o - 2>/dev/null || import -window root -screen png:-")) {
      return { stdout: pngHeader(1440, 900) };
    }

    return { stdout: Buffer.from("") };
  };
}

function assertPng(buffer) {
  assert.equal(buffer[0], 0x89);
  assert.equal(buffer[1], 0x50);
  assert.equal(buffer[2], 0x4e);
  assert.equal(buffer[3], 0x47);
}

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
