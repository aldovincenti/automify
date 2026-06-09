import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createDockerDesktopComputer, filesToData, initAutomify, jsonOutput } from "../../src/index.js";

const shouldRun = process.env.RUN_OPENAI_E2E === "1" && process.env.OPENAI_API_KEY;
const shouldRunBrowserDemo = shouldRun && process.env.RUN_OPENAI_BROWSER_E2E === "1";
const shouldRunDockerDesktop = shouldRun && process.env.RUN_OPENAI_DOCKER_DESKTOP_E2E === "1";
const shouldRunQemuCli = shouldRun && process.env.RUN_OPENAI_QEMU_CLI_E2E === "1";
const shouldRunQemuDesktop = shouldRun && process.env.RUN_OPENAI_QEMU_DESKTOP_E2E === "1";
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
        assert.ok(runnerCalls.length >= 1);
        assert.ok(runnerCalls.every((command) => /^node\b/.test(command)));
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
  "live demo: OpenAI runs a smoke command in a QEMU virtual CLI",
  { skip: !shouldRunQemuCli, timeout: 600_000 },
  async () => {
    const qemu = qemuOptionsFromEnv();
    const automify = initAutomify({
      provider: {
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: liveModel
      },
      silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
    });
    const commandSteps = [];
    const cli = automify.virtualCli({
      ...qemu,
      vmName: `automify-live-qemu-cli-${Date.now()}`,
      timeoutMs: 60_000,
      startupTimeoutMs: 300_000,
      command: {
        allow: [/^uname -m$/]
      },
      onStep: (event) => {
        if (event.phase === "after_command") commandSteps.push(event);
      }
    });

    try {
      const run = await cli.do(
        [
          "Call run_command exactly once with the exact command string: uname -m",
          "Do not wrap it in sh, do not add flags, and do not run any other command.",
          "Return the machine architecture from stdout."
        ].join(" "),
        {
          output: jsonOutput("qemu_cli_smoke_result", {
            machine: "string",
            summary: "string"
          })
        }
      );

      assert.equal(run.completed, true);
      assert.ok(run.response.id);
      assert.equal(
        commandSteps.length,
        1,
        `expected exactly one QEMU CLI command, got: ${commandSteps
          .map((step) => step.command?.command)
          .filter(Boolean)
          .join(", ")}`
      );
      assert.equal(commandSteps[0].command.command, "uname -m");
      assert.match(commandSteps[0].output.stdout, /\S/);
      assert.match(run.parsed.machine, /\S/);
      assert.match(run.parsed.summary, /\S/);
    } finally {
      await cli.close();
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
  "live demo: OpenAI runs browser task steps with screen recording",
  { skip: !shouldRunBrowserDemo, timeout: 180_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "automify-live-browser-task-recording-"));
    const recordingPath = join(dir, "run.mp4");
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
      const run = await browser
        .addStep("Add the person from data.")
        .addWait(500)
        .addExtract("Return the saved record JSON.")
        .addData({ firstName: "Grace", lastName: "Hopper" })
        .run({
          screenRecording: {
            path: recordingPath,
            fps: 2,
            captureIntervalMs: 250,
            execFile: async (command, args) => {
              assert.equal(command, "ffmpeg");
              await writeFile(args.at(-1), Buffer.from("video"));
            }
          },
          output: jsonOutput("person_record", {
            id: "string",
            firstName: "string",
            lastName: "string"
          })
        });

      const record = JSON.parse(await browser.page.locator("#latest-record-json").textContent());
      const video = await readFile(recordingPath);
      assert.equal(run.completed, true);
      assert.ok(run.response.id);
      assert.equal(record.firstName, "Grace");
      assert.equal(record.lastName, "Hopper");
      assert.equal(run.parsed.firstName, "Grace");
      assert.equal(run.parsed.lastName, "Hopper");
      assert.match(run.parsed.id, /^[0-9a-f-]{36}$/i);
      assert.equal(run.recording.path, recordingPath);
      assert.equal(run.recording.bytes, video.byteLength);
      assert.ok(run.recording.frames >= 1);
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "live demo: OpenAI runs sequential browser task steps with screen recording",
  { skip: !shouldRunBrowserDemo, timeout: 240_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "automify-live-browser-sequential-recording-"));
    const recordingPath = join(dir, "run.mp4");
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
      const run = await browser
        .task({ mode: "sequential" })
        .addStep("Fill only the first name field with Dorothy.")
        .addStep("Fill only the last name field with Vaughan.")
        .addStep("Submit the form.")
        .addExtract("Return the saved record JSON.", {
          key: "record",
          shape: {
            id: "string",
            firstName: "string",
            lastName: "string"
          }
        })
        .run({
          screenRecording: {
            path: recordingPath,
            fps: 2,
            captureIntervalMs: 250,
            execFile: async (command, args) => {
              assert.equal(command, "ffmpeg");
              await writeFile(args.at(-1), Buffer.from("video"));
            }
          }
        });

      const record = JSON.parse(await browser.page.locator("#latest-record-json").textContent());
      const video = await readFile(recordingPath);
      assert.equal(run.completed, true);
      assert.ok(run.response.id);
      assert.equal(record.firstName, "Dorothy");
      assert.equal(record.lastName, "Vaughan");
      assert.equal(run.parsed.record.firstName, "Dorothy");
      assert.equal(run.parsed.record.lastName, "Vaughan");
      assert.match(run.parsed.record.id, /^[0-9a-f-]{36}$/i);
      assert.equal(run.taskSteps.length, 4);
      assert.ok(run.steps.length >= 3);
      assert.equal(run.recording.path, recordingPath);
      assert.equal(run.recording.bytes, video.byteLength);
      assert.ok(run.recording.frames >= 1);
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "live demo: OpenAI uses the QEMU virtual desktop terminal example",
  { skip: !shouldRunQemuDesktop, timeout: 600_000 },
  async () => {
    const qemu = qemuOptionsFromEnv();
    const dir = await mkdtemp(join(tmpdir(), "automify-live-demo-qemu-desktop-"));
    const finalScreenshot = join(dir, "final.png");
    const automify = initAutomify({
      provider: {
        type: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: liveModel
      },
      silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
    });
    const desktop = await automify.virtualComputer({
      ...qemu,
      vmName: `automify-live-qemu-desktop-${Date.now()}`,
      startupTimeoutMs: 300_000,
      commandTimeoutMs: 120_000,
      desktop: {
        startupCommand: "xterm"
      },
      silent: process.env.AUTOMIFY_LIVE_LOGS !== "1"
    });

    try {
      const run = await desktop.do(
        "Use the open terminal to run uname -m, then return the machine architecture shown on screen.",
        {
          finalScreenshot,
          output: jsonOutput("qemu_system_info", {
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

test(
  "live: OpenAI can inspect a real Chromium Docker desktop",
  { skip: !shouldRunDockerDesktop, timeout: 240_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "automify-live-docker-desktop-"));
    const initialScreenshot = join(dir, "initial.png");
    const finalScreenshot = join(dir, "final.png");
    const computer = await createDockerDesktopComputer({
      image: process.env.AUTOMIFY_DOCKER_DESKTOP_IMAGE,
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
  { skip: !shouldRunDockerDesktop, timeout: 240_000 },
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
      image: process.env.AUTOMIFY_DOCKER_DESKTOP_IMAGE,
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

function qemuOptionsFromEnv() {
  const vm = {
    image: process.env.AUTOMIFY_QEMU_IMAGE,
    memory: process.env.AUTOMIFY_QEMU_MEMORY,
    cpus: process.env.AUTOMIFY_QEMU_CPUS,
    accel: process.env.AUTOMIFY_QEMU_ACCEL,
    machine: process.env.AUTOMIFY_QEMU_MACHINE,
    cpu: process.env.AUTOMIFY_QEMU_CPU,
    firmware: process.env.AUTOMIFY_QEMU_FIRMWARE
  };
  for (const [key, value] of Object.entries(vm)) {
    if (value == null || value === "") delete vm[key];
  }

  const ssh = {
    user: process.env.AUTOMIFY_QEMU_SSH_USER,
    keyPath: process.env.AUTOMIFY_QEMU_SSH_KEY
  };
  for (const [key, value] of Object.entries(ssh)) {
    if (value == null || value === "") delete ssh[key];
  }

  const options = {
    vm,
    ssh,
    qemuCommand: process.env.AUTOMIFY_QEMU_COMMAND,
    qemuImgCommand: process.env.AUTOMIFY_QEMU_IMG_COMMAND,
    qemuImageCacheDir: process.env.AUTOMIFY_QEMU_IMAGE_CACHE_DIR,
    qemuImageUrl: process.env.AUTOMIFY_QEMU_DEFAULT_IMAGE_URL
  };
  if (process.env.AUTOMIFY_QEMU_SUDO != null) {
    options.sudo = process.env.AUTOMIFY_QEMU_SUDO === "1";
  }
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === "") delete options[key];
  }
  if (process.env.AUTOMIFY_QEMU_SSH_PORT) {
    options.sshPort = Number(process.env.AUTOMIFY_QEMU_SSH_PORT);
  }
  return options;
}
