import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createDockerDesktopComputer, filesToData, initAutomify, jsonOutput } from "../../src/index.js";

const shouldRun = process.env.RUN_OPENAI_E2E === "1" && process.env.OPENAI_API_KEY;
const shouldRunBrowserDemo = shouldRun && process.env.RUN_OPENAI_BROWSER_E2E === "1";
const shouldRunVirtualDesktop = shouldRun && process.env.RUN_OPENAI_VIRTUAL_DESKTOP_E2E === "1";
const liveModel = process.env.OPENAI_MODEL ?? process.env.OPENAI_TEXT_MODEL ?? "gpt-5.5";
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const liveDemoCliCommand = "node -e \"console.log('automify live cli ok')\"";

test(
  "live: OpenAI Responses API runs a CLI tool call and returns structured output",
  { skip: !shouldRun },
  async () => {
    const runnerCalls = [];
    const automify = initAutomify({
      provider: {
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: liveModel
      },
      silent: true
    });
    const cli = automify.cli({
      approval: "never",
      allowedCommands: ["printf"],
      runner: async (command) => {
        runnerCalls.push(command);
        return {
          exitCode: 0,
          stdout: "automify-live\n",
          stderr: ""
        };
      }
    });

    const result = await cli.do("Run printf once to produce the text automify-live, then return it.", {
      maxSteps: 4,
      output: jsonOutput("live_cli_result", {
        command: "string",
        stdout: "string",
        sawAutomifyLive: "boolean"
      })
    });

    assert.equal(result.completed, true);
    assert.ok(result.response.id);
    assert.equal(runnerCalls.length, 1);
    assert.match(runnerCalls[0], /^printf\b/);
    assert.equal(result.parsed.sawAutomifyLive, true);
    assert.match(result.parsed.stdout, /automify-live/);
  }
);

test(
  "live demo: OpenAI runs a lightweight CLI smoke command and returns structured output",
  { skip: !shouldRun, timeout: 120_000 },
  async () => {
    const runnerCalls = [];
    const automify = initAutomify({
      provider: {
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: liveModel
      },
      silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
    });
    const cli = automify.cli({
      logFile: join(tmpdir(), `automify-live-demo-cli-${Date.now()}.jsonl`),
      command: {
        cwd: rootDirectory,
        allow: [liveDemoCliCommand]
      },
      runner: async (command) => {
        runnerCalls.push(command);
        return {
          command,
          cwd: rootDirectory,
          exitCode: 0,
          stdout: "automify live cli ok\n",
          stderr: "",
          timedOut: false
        };
      }
    });

    const run = await cli.do(`Run the allowed smoke command exactly once: ${liveDemoCliCommand}`, {
      maxSteps: 4,
      output: jsonOutput("cli_smoke_result", {
        ok: "boolean",
        summary: "string"
      })
    });

    assert.equal(run.completed, true);
    assert.ok(run.response.id);
    assert.deepEqual(runnerCalls, [liveDemoCliCommand]);
    assert.equal(run.parsed.ok, true);
    assert.match(run.parsed.summary, /automify live cli ok/i);
  }
);

test(
  "live demo: OpenAI summarizes a shared CSV through the Docker CLI example",
  { skip: !shouldRun, timeout: 120_000 },
  async () => {
    const sharedDir = await mkdtemp(join(tmpdir(), "automify-live-demo-docker-cli-"));
    const dataDir = join(sharedDir, "data");
    const reportPath = join(dataDir, "report.csv");
    const summaryPath = join(dataDir, "summary.json");
    const runnerCalls = [];
    const automify = initAutomify({
      provider: {
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: liveModel
      },
      silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
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
        allowedCommands: ["node"],
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
          [
            "Read data/report.csv and update data/summary.json with revenue totals by region.",
            "Use a Node.js command, then return the top region and total revenue."
          ].join(" "),
          {
            maxSteps: 4,
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

        assert.equal(run.completed, true);
        assert.ok(run.response.id);
        assert.equal(runnerCalls.length, 1);
        assert.match(runnerCalls[0], /^node\b/);
        assert.equal(run.parsed.topRegion, "North");
        assert.equal(run.parsed.totalRevenue, 4460);
        assert.equal(summaryFile.byRegion.North, 3480);
        assert.equal(summaryFile.byRegion.South, 980);
      } finally {
        await cli.close();
      }
    } finally {
      await rm(sharedDir, { recursive: true, force: true });
    }
  }
);

test(
  "live demo: OpenAI fills the browser demo page and returns the saved record",
  { skip: !shouldRunBrowserDemo, timeout: 180_000 },
  async () => {
    const automify = initAutomify({
      provider: {
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: liveModel
      },
      silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
    });
    const browser = await automify.browser({
      startUrl: pathToFileURL(join(rootDirectory, "docs/demo.html")).href,
      headless: true
    });

    try {
      const run = await browser.do("Add this person and return the saved record.", {
        maxSteps: 12,
        data: { firstName: "Ada", lastName: "Lovelace" },
        output: jsonOutput("person_record", {
          id: "string",
          firstName: "string",
          lastName: "string"
        })
      });

      const record = JSON.parse(await browser.page.locator("#latest-record-json").textContent());
      assert.equal(run.completed, true);
      assert.ok(run.response.id);
      assert.equal(record.firstName, "Ada");
      assert.equal(record.lastName, "Lovelace");
      assert.equal(run.parsed.firstName, "Ada");
      assert.equal(run.parsed.lastName, "Lovelace");
      assert.match(run.parsed.id, /^[0-9a-f-]{36}$/i);
    } finally {
      await browser.close();
    }
  }
);

test(
  "live: OpenAI can inspect a real Chromium Docker desktop",
  { skip: !shouldRunVirtualDesktop, timeout: 240_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "automify-live-docker-desktop-"));
    const initialScreenshot = join(dir, "initial.png");
    const finalScreenshot = join(dir, "final.png");
    const computer = await createDockerDesktopComputer({
      image: process.env.AUTOMIFY_VIRTUAL_DESKTOP_IMAGE,
      containerName: `automify-live-chromium-${Date.now()}`,
      startupTimeoutMs: 180_000,
      additionalAptPackages: ["chromium"],
      startupCommand:
        "chromium --no-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --no-default-browser-check about:blank",
      silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
    });

    try {
      const { stdout } = await computer.session.exec(["sh", "-lc", "chromium --version"], { encoding: "utf8" });
      assert.match(stdout, /Chromium/i);

      const automify = initAutomify({
        provider: {
          type: "openai",
          apiKey: process.env.OPENAI_API_KEY,
          model: liveModel
        },
        silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
      });
      const desktop = automify.computer({ computer });
      const result = await desktop.do(
        "Look at the screenshot of the virtual Linux desktop. Report whether a Chromium browser window is visible. Do not navigate anywhere.",
        {
          maxSteps: 4,
          initialScreenshot,
          finalScreenshot,
          output: jsonOutput("live_virtual_desktop_result", {
            chromiumVisible: "boolean",
            summary: "string"
          })
        }
      );

      const initial = await readFile(initialScreenshot);
      const final = await readFile(finalScreenshot);

      assertPng(initial);
      assertPng(final);
      assert.equal(result.completed, true);
      assert.ok(result.response.id);
      assert.equal(typeof result.parsed.chromiumVisible, "boolean");
      assert.equal(typeof result.parsed.summary, "string");
      assert.ok(result.parsed.summary.length > 0);
    } finally {
      await computer.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "live demo: OpenAI uses the Docker desktop terminal example",
  { skip: !shouldRunVirtualDesktop, timeout: 240_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "automify-live-demo-docker-desktop-"));
    const finalScreenshot = join(dir, "final.png");
    const automify = initAutomify({
      provider: {
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: liveModel
      },
      silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
    });
    const desktop = await automify.dockerComputer({
      image: process.env.AUTOMIFY_VIRTUAL_DESKTOP_IMAGE,
      containerName: `automify-live-terminal-${Date.now()}`,
      startupTimeoutMs: 180_000,
      desktop: {
        startupCommand: "xterm"
      },
      silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
    });

    try {
      const run = await desktop.do(
        "Use the open terminal to run uname -m, then return the machine architecture shown on screen.",
        {
          maxSteps: 8,
          finalScreenshot,
          output: jsonOutput("system_info", {
            machine: "string",
            summary: "string"
          })
        }
      );
      const final = await readFile(finalScreenshot);

      assertPng(final);
      assert.equal(run.completed, true);
      assert.ok(run.response.id);
      assert.match(run.parsed.machine, /\S/);
      assert.match(run.parsed.summary, /\S/);
    } finally {
      await desktop.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);

function assertPng(buffer) {
  assert.equal(buffer[0], 0x89);
  assert.equal(buffer[1], 0x50);
  assert.equal(buffer[2], 0x4e);
  assert.equal(buffer[3], 0x47);
}
