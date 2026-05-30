import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createCliAutomify } from "../../src/index.js";

test("e2e: CLI automify runs a real command and returns parsed output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "automify-cli-e2e-"));
  const calls = [];
  const cli = createCliAutomify({
    client: {
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
                arguments: JSON.stringify({ command: "printf automify-cli-e2e" })
              }
            ]
          };
        }

        const commandOutput = JSON.parse(payload.input[0].output);
        return {
          id: "resp_done",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    command: "printf automify-cli-e2e",
                    stdout: commandOutput.stdout,
                    exitCode: commandOutput.exitCode
                  })
                }
              ]
            }
          ]
        };
      }
    },
    model: "test-cli-model",
    cwd: directory,
    allowedCommands: ["printf"]
  });

  try {
    const result = await cli.do("Run the command.", {
      output: {
        type: "json_schema",
        name: "cli_result",
        schema: {
          type: "object",
          properties: {
            command: { type: "string" },
            stdout: { type: "string" },
            exitCode: { type: "integer" }
          },
          required: ["command", "stdout", "exitCode"],
          additionalProperties: false
        }
      }
    });

    assert.equal(result.completed, true);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].output.stdout, "automify-cli-e2e");
    assert.deepEqual(result.parsed, {
      command: "printf automify-cli-e2e",
      stdout: "automify-cli-e2e",
      exitCode: 0
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
