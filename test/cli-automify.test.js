import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createCliAutomify, jsonOutput, runShellCommand } from "../src/index.js";

test("CliAutomify runs model-requested commands and returns outputs", async () => {
  const payloads = [];
  const runnerCalls = [];
  const client = {
    async createResponse(payload) {
      payloads.push(payload);

      if (payloads.length === 1) {
        return {
          id: "resp_1",
          output: [
            {
              type: "function_call",
              name: "run_command",
              call_id: "call_1",
              arguments: JSON.stringify({ command: "pwd" })
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
  const cli = createCliAutomify({
    client,
    model: "test-cli-model",
    cwd: "/tmp/project",
    runner: async (command, options) => {
      runnerCalls.push({ command, options });
      return { exitCode: 0, stdout: "/tmp/project\n", stderr: "" };
    }
  });

  const result = await cli.do("Tell me where I am", { data: { purpose: "test" } });

  assert.equal(result.ok, true);
  assert.equal(result.status, "succeeded");
  assert.equal(result.completed, true);
  assert.equal(result.text, "Done");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].command.command, "pwd");
  assert.deepEqual(runnerCalls, [
    {
      command: "pwd",
      options: {
        cwd: "/tmp/project",
        env: undefined,
        shell: true,
        timeoutMs: 30000
      }
    }
  ]);
  assert.equal(payloads[0].model, "test-cli-model");
  assert.equal(payloads[0].tools[0].name, "run_command");
  assert.deepEqual(payloads[0].tools[0].parameters.required, ["command", "cwd", "timeoutMs"]);
  assert.deepEqual(payloads[0].tools[0].parameters.properties.cwd.type, ["string", "null"]);
  assert.deepEqual(payloads[0].tools[0].parameters.properties.timeoutMs.type, ["number", "null"]);
  assert.match(payloads[0].input[0].content[0].text, /Working directory:\n\/tmp\/project/);
  assert.equal(payloads[1].previous_response_id, "resp_1");
  assert.equal(payloads[1].input[0].type, "function_call_output");
  assert.equal(payloads[1].input[0].call_id, "call_1");
  assert.match(payloads[1].input[0].output, /tmp\/project/);
});

test("CliAutomify supports the task builder and keyed extracts", async () => {
  const payloads = [];
  const cli = createCliAutomify({
    client: {
      async createResponse(payload) {
        payloads.push(payload);
        return {
          id: "resp_done",
          output: [{ type: "message", content: [{ type: "output_text", text: '{"summary":{"ok":true}}' }] }]
        };
      }
    },
    model: "test-cli-model",
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  const result = await cli
    .addStep("Inspect the project.")
    .addExtract("Return a summary.", {
      key: "summary",
      shape: { ok: "boolean" }
    })
    .run();

  assert.match(payloads[0].input[0].content[0].text, /Follow these steps in order/);
  assert.equal(payloads[0].text.format.name, "task_extracts");
  assert.equal(result.parsed.summary.ok, true);
});

test("CliAutomify supports a direct task extract output", async () => {
  const payloads = [];
  const cli = createCliAutomify({
    client: {
      async createResponse(payload) {
        payloads.push(payload);
        return {
          id: "resp_done",
          output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }]
        };
      }
    },
    model: "test-cli-model",
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  const result = await cli.addExtract("Return a summary.", jsonOutput("summary", { ok: "boolean" })).run();

  assert.equal(payloads[0].text.format.name, "summary");
  assert.equal(result.parsed.ok, true);
});

test("CliAutomify supports sequential task steps and keyed extracts", async () => {
  const payloads = [];
  const cli = createCliAutomify({
    client: {
      async createResponse(payload) {
        payloads.push(payload);
        const text = payload.text?.format?.name === "summary" ? '{"ok":true}' : "Done";
        return {
          id: `resp_${payloads.length}`,
          output: [{ type: "message", content: [{ type: "output_text", text }] }]
        };
      }
    },
    model: "test-cli-model",
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  const result = await cli
    .task({ mode: "sequential" })
    .addStep("Inspect the project.")
    .addExtract("Return a summary.", {
      key: "summary",
      shape: { ok: "boolean" }
    })
    .run();

  assert.equal(payloads.length, 2);
  assert.match(payloads[0].input[0].content[0].text, /Complete task step 1 of 2/);
  assert.match(payloads[1].input[0].content[0].text, /extract: Return a summary/);
  assert.equal(payloads[1].text.format.name, "summary");
  assert.equal(result.taskSteps.length, 2);
  assert.deepEqual(result.parsed, { summary: { ok: true } });
});

test("CliAutomify can require command approval", async () => {
  const client = {
    async createResponse() {
      return {
        id: "resp_1",
        output: [
          {
            type: "function_call",
            name: "run_command",
            call_id: "call_1",
            arguments: JSON.stringify({ command: "rm -rf build" })
          }
        ]
      };
    }
  };
  const cli = createCliAutomify({
    client,
    model: "test-cli-model",
    approval: "always",
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  await assert.rejects(() => cli.do("Clean build output"), /approval is required/);
});

test("CliAutomify does not require approval by default", async () => {
  const runnerCalls = [];
  const client = {
    async createResponse(payload) {
      if (payload.previous_response_id) {
        return { id: "resp_2", output: [] };
      }

      return {
        id: "resp_1",
        output: [
          {
            type: "function_call",
            name: "run_command",
            call_id: "call_1",
            arguments: JSON.stringify({ command: "ls" })
          }
        ]
      };
    }
  };
  const cli = createCliAutomify({
    client,
    model: "test-cli-model",
    runner: async (command) => {
      runnerCalls.push(command);
      return { exitCode: 0, stdout: "README.md\n", stderr: "" };
    }
  });

  const result = await cli.do("List files");

  assert.equal(result.completed, true);
  assert.deepEqual(runnerCalls, ["ls"]);
});

test("CliAutomify uses confirmCommand when approval is enabled", async () => {
  let confirmed;
  const client = {
    async createResponse(payload) {
      if (!payload.previous_response_id) {
        return {
          id: "resp_1",
          output: [
            {
              type: "function_call",
              name: "run_command",
              call_id: "call_1",
              arguments: JSON.stringify({ command: "ls" })
            }
          ]
        };
      }

      return { id: "resp_2", output: [] };
    }
  };
  const cli = createCliAutomify({
    client,
    model: "test-cli-model",
    confirmCommand: ({ command }) => {
      confirmed = command.command;
      return true;
    },
    runner: async () => ({ exitCode: 0, stdout: "README.md\n", stderr: "" })
  });

  await cli.do("List files");

  assert.equal(confirmed, "ls");
});

test("CliAutomify enforces allowed and blocked command policies", async () => {
  const client = {
    async createResponse() {
      return {
        id: "resp_1",
        output: [
          {
            type: "function_call",
            name: "run_command",
            call_id: "call_1",
            arguments: JSON.stringify({ command: "rm -rf build" })
          }
        ]
      };
    }
  };
  const cli = createCliAutomify({
    client,
    model: "test-cli-model",
    approval: "never",
    blockedCommands: ["rm"],
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  await assert.rejects(() => cli.do("Clean build output"), /blocked by policy/);
});

test("CliAutomify includes command policy guidance in the model request", async () => {
  const payloads = [];
  const client = {
    async createResponse(payload) {
      payloads.push(payload);
      return { id: "resp_done", output: [] };
    }
  };
  const cli = createCliAutomify({
    client,
    model: "test-cli-model",
    allowedCommands: ["npm test", /^git\s+status\b/],
    blockedCommands: ["rm"],
    approval: "always",
    confirmCommand: () => true,
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  await cli.do("Check the repo.");

  assert.match(payloads[0].instructions, /Use deterministic, task-directed commands/);
  assert.match(payloads[0].instructions, /Do not repeat a command after no useful change/);
  assert.match(payloads[0].instructions, /Command policy:/);
  assert.match(payloads[0].instructions, /"npm test" \(exact command or command prefix with arguments\)/);
  assert.match(payloads[0].instructions, /full shell command string/);
  assert.match(payloads[0].instructions, /This allowlist is mandatory/);
  assert.match(payloads[0].instructions, /if \[ -f data\/file \]/);
  assert.match(payloads[0].instructions, /which command rule is missing/);
  assert.match(payloads[0].instructions, /\/\^git\\s\+status\\b\//);
  assert.match(payloads[0].instructions, /"rm" \(exact command or command prefix with arguments\)/);
  assert.match(payloads[0].instructions, /Commands require approval before execution/);
});

test("CliAutomify emits observability hooks", async () => {
  const events = [];
  const client = {
    async createResponse(payload) {
      if (!payload.previous_response_id) {
        return {
          id: "resp_1",
          output: [
            {
              type: "function_call",
              name: "run_command",
              call_id: "call_1",
              arguments: JSON.stringify({ command: "echo ok" })
            }
          ]
        };
      }

      return { id: "resp_2", output: [] };
    }
  };
  const cli = createCliAutomify({
    client,
    model: "test-cli-model",
    approval: "never",
    onRequest: (_payload, meta) => events.push(`request:${meta.phase}`),
    onResponse: (_response, meta) => events.push(`response:${meta.phase}`),
    onStep: (event) => events.push(`step:${event.phase}`),
    runner: async () => ({ exitCode: 0, stdout: "ok\n", stderr: "" })
  });

  await cli.do("Echo ok");

  assert.deepEqual(events, [
    "request:initial",
    "response:initial",
    "step:before_command",
    "step:after_command",
    "request:continue",
    "response:continue"
  ]);
});

test("CliAutomify emits debug command events", async () => {
  const logs = [];
  const client = {
    async createResponse(payload) {
      if (!payload.previous_response_id) {
        return {
          id: "resp_1",
          output: [
            {
              type: "function_call",
              name: "run_command",
              call_id: "call_1",
              arguments: JSON.stringify({ command: "echo ok" })
            }
          ]
        };
      }

      return { id: "resp_2", output: [] };
    }
  };
  const cli = createCliAutomify({
    client,
    model: "test-cli-model",
    debug(message, details) {
      logs.push([message, details]);
    },
    runner: async () => ({ exitCode: 0, stdout: "ok\n", stderr: "" })
  });

  await cli.do("Echo ok");

  const commandLog = logs.find(([message]) => message === "[automify:cli] command");
  const resultLog = logs.find(([message]) => message === "[automify:cli] command_result");
  assert.equal(commandLog[1].command.command, "echo ok");
  assert.equal(resultLog[1].exitCode, 0);
  assert.equal(resultLog[1].stdoutLength, 3);
});

test("CliAutomify defaults debug to false", () => {
  const cli = createCliAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-cli-model"
  });

  assert.equal(cli.debug, false);
});

test("CliAutomify writes debug events to logFile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-cli-logs-"));
  const logFile = join(dir, "runs", "cli.jsonl");
  const client = {
    async createResponse(payload) {
      if (!payload.previous_response_id) {
        return {
          id: "resp_1",
          output: [
            {
              type: "function_call",
              name: "run_command",
              call_id: "call_1",
              arguments: JSON.stringify({ command: "echo ok" })
            }
          ]
        };
      }

      return { id: "resp_2", output: [] };
    }
  };
  const cli = createCliAutomify({
    client,
    model: "test-cli-model",
    logFile,
    runner: async () => ({ exitCode: 0, stdout: "ok\n", stderr: "" })
  });

  await cli.do("Echo ok");

  const events = (await readFile(logFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.scope === "automify:cli" && event.message === "command"));
  assert.ok(events.some((event) => event.scope === "automify:cli" && event.message === "command_result"));
});

test("CliAutomify can silence logs", async () => {
  const logs = [];
  const cli = createCliAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-cli-model",
    silent: true,
    debug(message, details) {
      logs.push([message, details]);
    }
  });

  await cli.do("Say nothing");

  assert.deepEqual(logs, []);
});

test("CliAutomify restores per-run silent override after errors", async () => {
  const cli = createCliAutomify({
    client: {
      async createResponse() {
        throw new Error("request failed");
      }
    },
    model: "test-cli-model",
    silent: false
  });

  await assert.rejects(() => cli.do("Fail", { silent: true }), /request failed/);

  assert.equal(cli.silent, false);
});

test("runShellCommand executes a real command", async () => {
  const output = await runShellCommand("node -e \"process.stdout.write('automify')\"", {
    cwd: process.cwd(),
    timeoutMs: 5000
  });

  assert.equal(output.exitCode, 0);
  assert.equal(output.stdout, "automify");
});

test("CliAutomify requires an explicit model", async () => {
  const cli = createCliAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  await assert.rejects(() => cli.do("Say done"), /model is required/);
  await assert.doesNotReject(() => cli.do("Say done", { model: "per-call-cli-model" }));
});

test("CliAutomify resolves and emits completion callbacks with input data", async () => {
  const completions = [];
  const cli = createCliAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-cli-model",
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    onComplete: (event) => completions.push(["global", event])
  });

  const result = await cli.do("Confirm command workflow", {
    data: { jobId: "job_1" },
    onComplete: (event) => completions.push(["run", event])
  });

  assert.equal(result.completed, true);
  assert.equal(completions.length, 2);
  assert.equal(completions[0][1].surface, "cli");
  assert.deepEqual(completions[0][1].data, { jobId: "job_1" });
  assert.equal(completions[1][1].result, result);
});

test("CliAutomify accepts a run object when no data is needed", async () => {
  const payloads = [];
  const cli = createCliAutomify({
    client: {
      async createResponse(payload) {
        payloads.push(payload);
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-cli-model"
  });

  await cli.do("Run tests", { cwd: "/tmp/project" });

  assert.match(payloads[0].input[0].content[0].text, /Working directory:\n\/tmp\/project/);
  assert.ok(!payloads[0].input[0].content[0].text.includes("Data:\n"));
});

test("CliAutomify rejects legacy top-level data and third-argument options", async () => {
  const cli = createCliAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-cli-model"
  });

  await assert.rejects(() => cli.do("Tell me where I am", { purpose: "test" }), /Put input values under data/);
  await assert.rejects(() => cli.do("Tell me where I am", {}, { model: "test-cli-model" }), /single run object/);
});

test("CliAutomify supports structured output and parses the final response", async () => {
  const payloads = [];
  const cli = createCliAutomify({
    client: {
      async createResponse(payload) {
        payloads.push(payload);
        if (payloads.length === 1) {
          return {
            id: "resp_1",
            output: [
              {
                type: "function_call",
                name: "run_command",
                call_id: "call_1",
                arguments: JSON.stringify({ command: "npm test" })
              }
            ]
          };
        }

        return {
          id: "resp_done",
          output: [{ type: "message", content: [{ type: "output_text", text: '{"passed":true}' }] }]
        };
      }
    },
    model: "test-cli-model",
    runner: async () => ({ exitCode: 0, stdout: "ok\n", stderr: "" })
  });

  const result = await cli.do("Summarize tests", {
    output: {
      type: "json_schema",
      name: "test_summary",
      schema: {
        type: "object",
        properties: {
          passed: { type: "boolean" }
        },
        required: ["passed"],
        additionalProperties: false
      }
    }
  });

  assert.equal(payloads[0].text.format.type, "json_schema");
  assert.equal(payloads[1].previous_response_id, "resp_1");
  assert.equal(payloads[1].text.format.type, "json_schema");
  assert.deepEqual(result.parsed, { passed: true });
  assert.equal(result.ok, true);
  assert.equal(result.status, "succeeded");
});

test("CliAutomify includes filesToEvaluate content in the initial request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-cli-evaluate-"));
  const imagePath = join(dir, "screen.png");
  await writeFile(imagePath, Buffer.from("fake-png"));
  const payloads = [];
  const cli = createCliAutomify({
    client: {
      async createResponse(payload) {
        payloads.push(payload);
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-cli-model"
  });

  await cli.do("Evaluate the image.", {
    filesToEvaluate: [{ path: imagePath, detail: "low" }]
  });

  assert.equal(payloads[0].input[0].content[1].type, "input_image");
  assert.equal(payloads[0].input[0].content[1].detail, "low");
  assert.match(payloads[0].input[0].content[1].image_url, /^data:image\/png;base64,/);
});

test("CliAutomify supports grouped do and adapter command options", async () => {
  const payloads = [];
  const runnerCalls = [];
  const cli = createCliAutomify({
    client: {
      async createResponse(payload) {
        payloads.push(payload);
        if (!payload.previous_response_id) {
          return {
            id: "resp_1",
            output: [
              {
                type: "function_call",
                name: "run_command",
                call_id: "call_1",
                arguments: JSON.stringify({ command: "pwd" })
              }
            ]
          };
        }
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-cli-model",
    command: {
      cwd: "/workspace",
      timeoutMs: 1234,
      allow: ["pwd"]
    },
    runner: async (command, options) => {
      runnerCalls.push({ command, options });
      return { exitCode: 0, stdout: "/workspace\n", stderr: "" };
    }
  });

  await cli.do("Run pwd.", {
    limits: { steps: 3 },
    request: { metadata: { run: "grouped" } },
    command: {
      cwd: "/tmp/override",
      timeout: 4321
    },
    hooks: {
      step() {}
    }
  });

  assert.equal(payloads[0].metadata.run, "grouped");
  assert.deepEqual(runnerCalls[0].options, {
    cwd: "/tmp/override",
    env: undefined,
    shell: true,
    timeoutMs: 4321
  });
});

test("CliAutomify validates adapter and command option names with suggestions", () => {
  assert.throws(
    () => createCliAutomify({ model: "test-cli-model", command: { allowedCommand: ["npm test"] } }),
    /Unknown CLI command option "allowedCommand". Did you mean "allowedCommands"\?/
  );

  assert.throws(
    () => createCliAutomify({ model: "test-cli-model", timeotMs: 1000 }),
    /Unknown CLI adapter option "timeotMs". Did you mean "timeoutMs"\?/
  );
});

test("CliAutomify repo preset configures common repository commands", async () => {
  const runnerCalls = [];
  const cli = createCliAutomify({
    client: {
      async createResponse(payload) {
        if (!payload.previous_response_id) {
          return {
            id: "resp_1",
            output: [
              {
                type: "function_call",
                name: "run_command",
                call_id: "call_1",
                arguments: JSON.stringify({ command: "git status" })
              }
            ]
          };
        }
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-cli-model",
    preset: "repo",
    runner: async (command, options) => {
      runnerCalls.push({ command, options });
      return { exitCode: 0, stdout: "clean\n", stderr: "" };
    }
  });

  await cli.do("Check status");

  assert.equal(runnerCalls[0].command, "git status");
  assert.equal(runnerCalls[0].options.cwd, process.cwd());
});
