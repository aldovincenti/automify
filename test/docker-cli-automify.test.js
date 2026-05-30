import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createDockerCliAutomify, DockerCliSession } from "../src/index.js";

test("DockerCliAutomify runs commands inside a Docker container", async () => {
  const calls = [];
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
  const cli = createDockerCliAutomify({
    client,
    model: "test-docker-cli-model",
    containerName: "automify-cli-test",
    image: "debian:bookworm-slim",
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      if (args[0] === "exec") {
        return { stdout: "/workspace\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    }
  });

  const result = await cli.do("Print working directory");

  assert.equal(result.text, "Done");
  assert.deepEqual(calls[0][1].slice(0, 6), ["run", "-d", "--name", "automify-cli-test", "--network", "bridge"]);
  assert.deepEqual(calls[1][1].slice(0, 5), ["exec", "--workdir", "/workspace", "automify-cli-test", "sh"]);
  assert.equal(calls[1][1].at(-1), "pwd");

  await cli.close();
  assert.deepEqual(calls.at(-1)[1], ["rm", "-f", "automify-cli-test"]);
});

test("DockerCliAutomify includes strict command policy guidance in the model request", async () => {
  const payloads = [];
  const client = {
    async createResponse(payload) {
      payloads.push(payload);
      return { id: "resp_done", output: [] };
    }
  };
  const cli = createDockerCliAutomify({
    client,
    model: "test-docker-cli-model",
    command: { allow: ["cat"] },
    execFile: async () => ({ stdout: "", stderr: "" })
  });

  await cli.do("Read the summary file.");

  assert.match(payloads[0].instructions, /Command policy:/);
  assert.match(payloads[0].instructions, /This allowlist is mandatory/);
  assert.match(payloads[0].instructions, /ls data && cat data\/file/);
  assert.match(payloads[0].tools[0].description, /full command string must satisfy/);

  await cli.close();
});

test("DockerCliAutomify writes CLI and Docker events to logFile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-docker-cli-logs-"));
  const logFile = join(dir, "docker-cli.jsonl");
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
              arguments: JSON.stringify({ command: "pwd" })
            }
          ]
        };
      }
      return { id: "resp_2", output: [] };
    }
  };
  const cli = createDockerCliAutomify({
    client,
    model: "test-docker-cli-model",
    containerName: "automify-cli-log-test",
    logFile,
    execFile: async (_command, args) => {
      if (args[0] === "exec") {
        return { stdout: "/workspace\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    }
  });

  await cli.do("Print working directory");
  await cli.close();

  const events = (await readFile(logFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.scope === "automify:cli" && event.message === "command"));
  assert.ok(events.some((event) => event.scope === "automify:docker-cli" && event.message === "docker"));
  assert.ok(events.some((event) => event.scope === "automify:docker-cli" && event.message === "command_result"));
});

test("DockerCliSession supports shared files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-docker-cli-test-"));
  const source = join(dir, "input.json");
  await writeFile(source, '{"ok":true}');
  const calls = [];
  const session = new DockerCliSession({
    containerName: "automify-cli-shared",
    sharedFolder: {
      containerPath: "/work",
      files: [{ path: source, targetPath: "data/input.json" }]
    },
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: "", stderr: "" };
    }
  });

  await session.run("ls data");

  const run = calls[0][1];
  const volumeIndex = run.indexOf("-v");
  assert.match(run[volumeIndex + 1], /:\/work:rw$/);
  assert.equal(session.sharedFolder.data.files[0].containerPath, "/work/data/input.json");

  await session.close();
});

test("DockerCliSession accepts container, workdir, shared, and sharedFiles aliases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-docker-cli-alias-"));
  const source = join(dir, "input.txt");
  await writeFile(source, "hello");
  const calls = [];
  const session = new DockerCliSession({
    container: {
      image: "automify-cli-image",
      name: "automify-cli-alias",
      network: false
    },
    workdir: "/work",
    shared: { containerPath: "/work" },
    sharedFiles: [{ path: source, targetPath: "input.txt" }],
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: "", stderr: "" };
    }
  });

  await session.run("pwd");

  const run = calls[0][1];
  assert.deepEqual(run.slice(0, 6), ["run", "-d", "--name", "automify-cli-alias", "--network", "none"]);
  assert.equal(run[run.indexOf("--workdir") + 1], "/work");
  assert.ok(run.includes("automify-cli-image"));
  assert.match(run[run.indexOf("-v") + 1], /:\/work:rw$/);

  await session.close();
});

test("DockerCliSession applies configurable Docker resource limits", async () => {
  const calls = [];
  const session = new DockerCliSession({
    container: {
      name: "automify-cli-resources",
      cpus: 1.5,
      memory: "768m",
      memorySwap: "1g",
      cpuShares: 256,
      cpusetCpus: "0-1"
    },
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: "", stderr: "" };
    }
  });

  await session.run("true");

  const run = calls[0][1];
  assert.equal(run[run.indexOf("--cpus") + 1], "1.5");
  assert.equal(run[run.indexOf("--memory") + 1], "768m");
  assert.equal(run[run.indexOf("--memory-swap") + 1], "1g");
  assert.equal(run[run.indexOf("--cpu-shares") + 1], "256");
  assert.equal(run[run.indexOf("--cpuset-cpus") + 1], "0-1");

  await session.close();
});

test("DockerCliSession can install additional apt packages before startup", async () => {
  const calls = [];
  const session = new DockerCliSession({
    container: {
      name: "automify-cli-packages",
      additionalAptPackages: ["nodejs", "coreutils", "nodejs"],
      startupCommand: "sleep infinity",
      readOnly: true
    },
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: "", stderr: "" };
    }
  });

  await session.run("node --version");

  const run = calls[0][1];
  const startup = run.at(-1);
  assert.match(startup, /apt-get update/);
  assert.match(startup, /apt-get install -y --no-install-recommends 'nodejs' 'coreutils'/);
  assert.match(startup, /sleep infinity$/);
  assert.equal(run.includes("--cap-drop"), false);
  assert.equal(run.includes("--read-only"), false);

  await session.close();
});

test("DockerCliAutomify includes prepared shared folder data in the initial request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-docker-cli-data-"));
  const source = join(dir, "input.txt");
  await writeFile(source, "hello");
  const payloads = [];
  const cli = createDockerCliAutomify({
    client: {
      async createResponse(payload) {
        payloads.push(payload);
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-docker-cli-model",
    files: [{ path: source, targetPath: "inputs/input.txt" }],
    execFile: async () => ({ stdout: "", stderr: "" })
  });

  await cli.do("Read the shared file.", {
    data: { purpose: "test" }
  });

  const text = payloads[0].input[0].content[0].text;
  assert.match(text, /"sharedFolder"/);
  assert.match(text, /\/workspace\/inputs\/input.txt/);

  await cli.close();
});

test("DockerCliSession repo preset mounts the current workspace", async () => {
  const calls = [];
  const session = new DockerCliSession({
    preset: "repo",
    container: { name: "automify-cli-preset" },
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: "", stderr: "" };
    }
  });

  await session.run("git status");

  const run = calls[0][1];
  assert.equal(run[run.indexOf("--name") + 1], "automify-cli-preset");
  assert.match(run[run.indexOf("-v") + 1], new RegExp(`${escapeRegExp(process.cwd())}:/workspace:rw$`));

  await session.close();
});

test("DockerCliSession validates shared option names", () => {
  assert.throws(
    () => new DockerCliSession({ sharedFile: ["input.txt"] }),
    /Unknown Docker CLI adapter option "sharedFile". Did you mean "sharedFiles"\?/
  );
});

test("DockerCliSession rejects legacy additionalPackages option", () => {
  assert.throws(
    () => new DockerCliSession({ additionalPackages: ["nodejs"] }),
    /Unknown Docker CLI adapter option "additionalPackages". Did you mean "additionalAptPackages"\?/
  );
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
