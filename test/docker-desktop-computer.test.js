import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  createDockerComputerAutomify,
  createDockerDesktopComputer,
  defaultDockerDesktopImage,
  dockerDesktopDockerfile
} from "../src/index.js";

test("createDockerDesktopComputer defaults to a public Debian image and installs minimal desktop tools", async () => {
  const calls = [];
  const computer = await createDockerDesktopComputer({
    containerName: "automify-default",
    startupCommand: "xterm",
    startupTimeoutMs: 1,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    }
  });

  const run = calls[0][1];
  const startupScript = run.at(-1);

  assert.equal(defaultDockerDesktopImage(), "debian:bookworm-slim");
  assert.ok(run.includes("debian:bookworm-slim"));
  assert.deepEqual(run.slice(0, 6), ["run", "-d", "--name", "automify-default", "--network", "bridge"]);
  assert.equal(run.includes("--read-only"), false);
  assert.equal(run.includes("--cap-drop"), false);
  assert.equal(run.includes("no-new-privileges"), false);
  assert.match(computer.instructions, /Do not open or use Alt\+Tab/);
  assert.match(computer.instructions, /Do not click as a probe/);
  assert.match(computer.instructions, /Use deterministic entry points/);
  assert.match(startupScript, /apt-get update/);
  assert.match(startupScript, /apt-get install -y --no-install-recommends/);
  assert.match(startupScript, /xvfb/);
  assert.match(startupScript, /xterm >/);
  assert.doesNotMatch(startupScript, /chromium/);
  assert.doesNotMatch(startupScript, /xmessage -center/);

  await computer.close();
  assert.deepEqual(calls.at(-1)[1], ["rm", "-f", "automify-default"]);
});

test("createDockerDesktopComputer can install additional apt packages", async () => {
  const calls = [];
  const computer = await createDockerDesktopComputer({
    containerName: "automify-additional-packages",
    startupCommand: "xterm",
    additionalAptPackages: ["chromium", "curl", "chromium"],
    startupTimeoutMs: 1,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    }
  });

  const startupScript = calls[0][1].at(-1);
  assert.match(startupScript, /xvfb/);
  assert.match(startupScript, /curl/);
  assert.match(startupScript, /chromium/);
  assert.equal(startupScript.match(/chromium/g).length, 1);

  await computer.close();
});

test("createDockerDesktopComputer can replace the default desktop package set", async () => {
  const calls = [];
  const computer = await createDockerDesktopComputer({
    containerName: "automify-custom-packages",
    startupCommand: "xterm",
    desktopPackages: ["xvfb"],
    additionalAptPackages: ["xdotool"],
    startupTimeoutMs: 1,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    }
  });

  const startupScript = calls[0][1].at(-1);
  const installLine = startupScript.split("\n").find((line) => line.includes("apt-get install"));
  assert.match(installLine, /xvfb/);
  assert.match(installLine, /xdotool/);
  assert.doesNotMatch(installLine, /openbox/);
  assert.doesNotMatch(installLine, /scrot/);

  await computer.close();
});

test("createDockerDesktopComputer requires a startup command", async () => {
  await assert.rejects(
    () =>
      createDockerDesktopComputer({
        containerName: "automify-no-app",
        startupTimeoutMs: 1,
        execFile: async () => ({ stdout: Buffer.from("") })
      }),
    /Docker desktop startupCommand is required/
  );

  await assert.rejects(
    () =>
      createDockerDesktopComputer({
        containerName: "automify-no-app-false",
        startupCommand: false,
        startupTimeoutMs: 1,
        execFile: async () => ({ stdout: Buffer.from("") })
      }),
    /Docker desktop startupCommand is required/
  );

  await assert.rejects(
    () =>
      createDockerDesktopComputer({
        existingContainer: true,
        containerName: "automify-existing-no-app",
        startupTimeoutMs: 1,
        execFile: async () => ({ stdout: Buffer.from("") })
      }),
    /Docker desktop startupCommand is required/
  );
});

test("createDockerDesktopComputer uses a UUID container name by default", async () => {
  const computer = await createDockerDesktopComputer({
    startupCommand: "xterm",
    start: false
  });

  assert.match(
    computer.session.name,
    /^automify-desktop-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});

test("createDockerDesktopComputer writes Docker desktop events to logFile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-docker-desktop-logs-"));
  const logFile = join(dir, "desktop.jsonl");
  const computer = await createDockerDesktopComputer({
    startupCommand: "xterm",
    start: false,
    logFile
  });

  await computer.close();

  const events = (await readFile(logFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.scope === "automify:docker-desktop" && event.message === "create"));
});

test("createDockerDesktopComputer locks explicit container names", async () => {
  const first = await createDockerDesktopComputer({
    startupCommand: "xterm",
    start: false,
    containerName: "automify-locked-name"
  });

  await assert.rejects(
    () =>
      createDockerDesktopComputer({
        startupCommand: "xterm",
        start: false,
        containerName: "automify-locked-name"
      }),
    /Docker desktop container "automify-locked-name" is already in use/
  );

  const other = await createDockerDesktopComputer({
    startupCommand: "xterm",
    start: false,
    containerName: "automify-other-name"
  });

  await first.close();

  const second = await createDockerDesktopComputer({
    startupCommand: "xterm",
    start: false,
    containerName: "automify-locked-name"
  });

  await other.close();
  await second.close();
});

test("createDockerComputerAutomify creates a closeable Docker desktop runner", async () => {
  const runner = await createDockerComputerAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-model",
    startupCommand: "xterm",
    start: false,
    containerName: "automify-docker-computer-runner"
  });

  assert.equal(runner.session.name, "automify-docker-computer-runner");
  await runner.close();
});

test("createDockerDesktopComputer can silence Docker desktop logs", async () => {
  const logs = [];
  const computer = await createDockerDesktopComputer({
    containerName: "automify-silent",
    startupCommand: "xterm",
    silent: true,
    debug(message, details) {
      logs.push([message, details]);
    },
    startupTimeoutMs: 1,
    execFile: async () => ({ stdout: Buffer.from("") })
  });

  await computer.close();
  assert.deepEqual(logs, []);
});

test("createDockerDesktopComputer starts a locked-down Docker desktop session", async () => {
  const calls = [];
  const computer = await createDockerDesktopComputer({
    image: "automify-test-image",
    containerName: "automify-test",
    startupCommand: "xterm",
    startupTimeoutMs: 1,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    }
  });

  assert.equal(computer.displayWidth, 1440);
  assert.equal(computer.displayHeight, 900);
  assert.equal(computer.environment, "linux");

  const run = calls[0][1];
  assert.deepEqual(run.slice(0, 6), ["run", "-d", "--name", "automify-test", "--network", "bridge"]);
  assert.ok(run.includes("--cap-drop"));
  assert.ok(run.includes("--security-opt"));
  assert.ok(run.includes("--read-only"));
  assert.ok(run.includes("automify-test-image"));

  await computer.close();
  assert.deepEqual(calls.at(-1)[1], ["rm", "-f", "automify-test"]);
});

test("createDockerDesktopComputer can disable networking explicitly", async () => {
  const calls = [];
  const computer = await createDockerDesktopComputer({
    image: "automify-test-image",
    containerName: "automify-no-network",
    startupCommand: "xterm",
    network: false,
    startupTimeoutMs: 1,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    }
  });

  assert.deepEqual(calls[0][1].slice(0, 6), ["run", "-d", "--name", "automify-no-network", "--network", "none"]);

  await computer.close();
});

test("createDockerDesktopComputer can request Docker auto-remove", async () => {
  const calls = [];
  const computer = await createDockerDesktopComputer({
    image: "automify-test-image",
    containerName: "automify-auto-remove",
    startupCommand: "xterm",
    autoRemove: true,
    startupTimeoutMs: 1,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    }
  });

  assert.deepEqual(calls[0][1].slice(0, 7), [
    "run",
    "-d",
    "--rm",
    "--name",
    "automify-auto-remove",
    "--network",
    "bridge"
  ]);

  await computer.close();
});

test("createDockerDesktopComputer mounts a shared folder and copies files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-docker-desktop-test-"));
  const source = join(dir, "input.txt");
  await writeFile(source, "hello desktop");
  const calls = [];
  const computer = await createDockerDesktopComputer({
    image: "automify-test-image",
    containerName: "automify-shared-desktop",
    startupCommand: "xterm",
    sharedFolder: {
      containerPath: "/shared",
      files: [{ path: source, targetPath: "docs/input.txt" }]
    },
    startupTimeoutMs: 1,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    }
  });

  const run = calls[0][1];
  const volumeIndex = run.indexOf("-v");
  assert.notEqual(volumeIndex, -1);
  assert.match(run[volumeIndex + 1], /:\/shared:rw$/);
  assert.equal(computer.sharedFolder.containerPath, "/shared");
  assert.equal(computer.sharedFolder.files[0].containerPath, "/shared/docs/input.txt");
  assert.equal(computer.sharedFolder.files[0].relativePath, "docs/input.txt");

  await computer.close();
});

test("createDockerDesktopComputer accepts container, viewport, desktop, shared aliases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-docker-desktop-alias-"));
  const source = join(dir, "input.txt");
  await writeFile(source, "hello");
  const calls = [];
  const computer = await createDockerDesktopComputer({
    container: {
      image: "automify-desktop-image",
      name: "automify-desktop-alias",
      network: false
    },
    viewport: { width: 1280, height: 720 },
    desktop: {
      startupCommand: "xterm",
      additionalAptPackages: ["curl"]
    },
    shared: { containerPath: "/shared" },
    sharedFiles: [{ path: source, targetPath: "input.txt" }],
    startupTimeoutMs: 1,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    }
  });

  const run = calls[0][1];
  assert.equal(computer.displayWidth, 1280);
  assert.equal(computer.displayHeight, 720);
  assert.deepEqual(run.slice(0, 6), ["run", "-d", "--name", "automify-desktop-alias", "--network", "none"]);
  assert.ok(run.includes("automify-desktop-image"));
  assert.match(run.at(-1), /1280x720x24/);
  assert.match(run.at(-1), /xterm/);
  assert.match(run[run.indexOf("-v") + 1], /:\/shared:rw$/);

  await computer.close();
});

test("createDockerDesktopComputer applies configurable Docker resource limits", async () => {
  const calls = [];
  const computer = await createDockerDesktopComputer({
    container: {
      image: "automify-desktop-image",
      name: "automify-desktop-resources",
      cpus: "2",
      memory: "1g",
      memorySwap: "2g",
      cpuShares: 512,
      cpusetCpus: "0"
    },
    startupCommand: "xterm",
    startupTimeoutMs: 1,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    }
  });

  const run = calls[0][1];
  assert.equal(run[run.indexOf("--cpus") + 1], "2");
  assert.equal(run[run.indexOf("--memory") + 1], "1g");
  assert.equal(run[run.indexOf("--memory-swap") + 1], "2g");
  assert.equal(run[run.indexOf("--cpu-shares") + 1], "512");
  assert.equal(run[run.indexOf("--cpuset-cpus") + 1], "0");

  await computer.close();
});

test("createDockerDesktopComputer reports Docker diagnostics when startup fails", async () => {
  const calls = [];

  await assert.rejects(
    () =>
      createDockerDesktopComputer({
        containerName: "automify-fails",
        startupCommand: "xterm",
        startupTimeoutMs: 1,
        execFile: async (command, args, options) => {
          calls.push([command, args, options]);
          if (args[0] === "inspect") {
            return { stdout: "exited exit=100 oom=false\n" };
          }
          if (args[0] === "logs") {
            return { stdout: "apt failed loudly\n", stderr: "" };
          }
          if (args[0] === "rm") {
            return { stdout: "" };
          }
          if (args[0] === "exec") {
            throw new Error("No such container");
          }
          return { stdout: "" };
        }
      }),
    (error) => {
      assert.match(error.message, /Docker diagnostics/);
      assert.match(error.message, /exited exit=100/);
      assert.match(error.message, /apt failed loudly/);
      return true;
    }
  );

  assert.ok(calls.some(([, args]) => args[0] === "inspect"));
  assert.ok(calls.some(([, args]) => args[0] === "logs"));
  assert.deepEqual(calls.at(-1)[1], ["rm", "-f", "automify-fails"]);

  const computer = await createDockerDesktopComputer({
    startupCommand: "xterm",
    start: false,
    containerName: "automify-fails"
  });
  await computer.close();
});

test("Docker desktop maps computer actions to xdotool inside the container", async () => {
  const calls = [];
  const computer = await createDockerDesktopComputer({
    start: false,
    existingContainer: true,
    containerName: "existing",
    startupCommand: "xterm",
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      if (args.at(-1)?.includes?.("scrot -o -")) {
        return { stdout: Buffer.from("png") };
      }
      return { stdout: Buffer.from("") };
    }
  });

  await computer.execute({ type: "click", x: 10.4, y: 20.6, button: "right" });
  await computer.execute({ type: "type", text: "hello" });
  const screenshot = await computer.screenshot();

  assert.equal(screenshot.toString(), "png");
  assert.deepEqual(calls[0][1], [
    "exec",
    "-e",
    "DISPLAY=:99",
    "existing",
    "xdotool",
    "mousemove",
    "10",
    "21",
    "click",
    "3"
  ]);
  assert.deepEqual(calls[1][1], [
    "exec",
    "-e",
    "DISPLAY=:99",
    "existing",
    "xdotool",
    "type",
    "--clearmodifiers",
    "--",
    "hello"
  ]);
  assert.deepEqual(calls[2][1].slice(0, 5), ["exec", "-e", "DISPLAY=:99", "existing", "sh"]);
  assert.match(calls[2][1].at(-1), /scrot -o -/);

  await computer.close();
});

test("dockerDesktopDockerfile documents the required container tools", () => {
  const dockerfile = dockerDesktopDockerfile();
  assert.match(dockerfile, /debian:bookworm-slim/);
  assert.match(dockerfile, /xvfb/);
  assert.match(dockerfile, /xterm/);
  assert.match(dockerfile, /xdotool/);
  assert.match(dockerfile, /imagemagick/);
  assert.doesNotMatch(dockerfile, /chromium/);
});

test("createDockerDesktopComputer validates container option names", async () => {
  await assert.rejects(
    () => createDockerDesktopComputer({ container: { imageName: "desktop:latest" } }),
    /Unknown Docker desktop container option "imageName"/
  );
});

test("createDockerDesktopComputer rejects legacy additionalPackages option", async () => {
  await assert.rejects(
    () => createDockerDesktopComputer({ additionalPackages: ["chromium"] }),
    /Unknown Docker desktop adapter option "additionalPackages". Did you mean "additionalAptPackages"\?/
  );
  await assert.rejects(
    () => createDockerDesktopComputer({ desktop: { additionalPackages: ["chromium"] } }),
    /Unknown Docker desktop desktop option "additionalPackages". Did you mean "additionalAptPackages"\?/
  );
});
