import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createVirtualCliAutomify, QemuCliSession } from "../src/index.js";
import {
  buildQemuArgs,
  defaultQemuFirmware,
  ensureDefaultQemuImageCache,
  prepareDefaultQemuImage
} from "../src/lib/qemu-runtime.js";

test("VirtualCliAutomify runs commands inside a QEMU VM over SSH", async () => {
  const calls = [];
  const spawns = [];
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
  const cli = createVirtualCliAutomify({
    client,
    model: "test-qemu-cli-model",
    image: "/tmp/automify-cli.qcow2",
    vmName: "automify-qemu-cli",
    sshPort: 11022,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      if (args.at(-1)?.includes?.("pwd")) {
        return { stdout: "/workspace\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    spawn: (command, args, options) => {
      spawns.push([command, args, options]);
      return fakeChild();
    }
  });

  const result = await cli.do("Print working directory");

  assert.equal(result.text, "Done");
  const qemuArgs = spawns[0][1];
  assert.equal(qemuArgs[qemuArgs.indexOf("-name") + 1], "automify-qemu-cli");
  assert.ok(qemuArgs.includes("file=/tmp/automify-cli.qcow2,if=virtio,format=qcow2"));
  assert.ok(qemuArgs.includes("user,id=net0,hostfwd=tcp:127.0.0.1:11022-:22"));

  const runCommand = calls.find(([, args]) => args.at(-1)?.includes?.("pwd"))[1].at(-1);
  assert.match(runCommand, /cd '\/workspace' && sh -lc 'pwd'/);

  await cli.close();
  assert.equal(cli.session.process.killed, true);
});

test("QemuCliSession supports shared files through QEMU virtfs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-qemu-cli-test-"));
  const source = join(dir, "input.json");
  await writeFile(source, '{"ok":true}');
  const spawns = [];
  const session = new QemuCliSession({
    image: "/tmp/shared-cli.qcow2",
    vmName: "automify-qemu-cli-shared",
    sshPort: 11023,
    sharedFolder: {
      containerPath: "/work",
      files: [{ path: source, targetPath: "data/input.json" }]
    },
    execFile: async () => ({ stdout: "", stderr: "" }),
    spawn: (command, args, options) => {
      spawns.push([command, args, options]);
      return fakeChild();
    }
  });

  await session.run("ls data", { cwd: "/work" });

  const qemuArgs = spawns[0][1];
  const virtfs = qemuArgs[qemuArgs.indexOf("-virtfs") + 1];
  assert.match(virtfs, /mount_tag=automify_shared/);
  assert.equal(session.sharedFolder.data.files[0].containerPath, "/work/data/input.json");

  await session.close();
});

test("QemuCliSession uses startupTimeoutMs for startup dependency installs", async () => {
  const calls = [];
  const session = new QemuCliSession({
    image: "/tmp/startup-timeout-cli.qcow2",
    vmName: "automify-qemu-cli-startup-timeout",
    sshPort: 11028,
    startupTimeoutMs: 123_456,
    timeoutMs: 7,
    additionalAptPackages: ["coreutils"],
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: "", stderr: "" };
    },
    spawn: () => fakeChild()
  });

  try {
    await session.run("whoami");

    const startup = calls.find(([, args]) => args.at(-1)?.includes?.("apt-get update"));
    assert.equal(startup[2].timeout, 123_456);

    const command = calls.find(([, args]) => args.at(-1)?.includes?.("whoami"));
    assert.equal(command[2].timeout, 7);
  } finally {
    await session.close();
  }
});

test("QemuCliSession repo preset exposes the current workspace", async () => {
  const spawns = [];
  const session = new QemuCliSession({
    preset: "repo",
    image: "/tmp/repo-cli.qcow2",
    vm: { name: "automify-qemu-cli-preset" },
    sshPort: 11024,
    execFile: async () => ({ stdout: "", stderr: "" }),
    spawn: (command, args, options) => {
      spawns.push([command, args, options]);
      return fakeChild();
    }
  });

  await session.run("git status");

  const qemuArgs = spawns[0][1];
  assert.equal(qemuArgs[qemuArgs.indexOf("-name") + 1], "automify-qemu-cli-preset");
  assert.match(qemuArgs[qemuArgs.indexOf("-virtfs") + 1], new RegExp(`path=${escapeRegExp(process.cwd())}`));

  await session.close();
});

test("QemuCliSession uses the default Debian image when no image is configured", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "automify-qemu-cli-cache-"));
  const calls = [];
  const spawns = [];
  const session = new QemuCliSession({
    vmName: "automify-qemu-cli-default",
    sshPort: 11025,
    qemuImageCacheDir: cacheDir,
    qemuImageUrl: "https://example.test/debian.qcow2",
    defaultImageCache: false,
    qemuImgCommand: "qemu-img-test",
    sshKeygenCommand: "ssh-keygen-test",
    createCloudInitServer: async () => ({ port: 18080, close: async () => {} }),
    fetchImpl: async () => new Response("qcow2-bytes"),
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      if (command === "ssh-keygen-test") {
        await writeFile(args.at(-1), "private-key");
        await writeFile(`${args.at(-1)}.pub`, "ssh-ed25519 AAAAautomify test-key\n");
      }
      return { stdout: "", stderr: "" };
    },
    spawn: (command, args, options) => {
      spawns.push([command, args, options]);
      return fakeChild();
    }
  });

  try {
    await session.run("whoami");

    assert.ok(calls.some(([command]) => command === "qemu-img-test"));
    assert.ok(calls.some(([command]) => command === "ssh-keygen-test"));
    const qemuArgs = spawns[0][1];
    assert.match(qemuArgs[qemuArgs.indexOf("-drive") + 1], /automify-qemu-debian-.*disk\.qcow2/);
    assert.match(qemuArgs[qemuArgs.indexOf("-smbios") + 1], /ds=nocloud-net;s=http:\/\/10\.0\.2\.2:18080\//);

    const sshCall = calls.find(([command, args]) => command === "ssh" && args.at(-1)?.includes?.("whoami"));
    assert.ok(sshCall[1].includes("-i"));
    assert.ok(sshCall[1].some((arg) => /^automify@127\.0\.0\.1$/.test(arg)));
  } finally {
    await session.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("QEMU default Debian base image is cached between prepared VMs", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "automify-qemu-cache-reuse-"));
  const calls = [];
  let fetches = 0;
  const options = {
    cacheDir,
    imageUrl: "https://example.test/debian-cached.qcow2",
    defaultImageCache: false,
    qemuImgCommand: "qemu-img-test",
    sshKeygenCommand: "ssh-keygen-test",
    createCloudInitServer: async () => ({ port: 18082, close: async () => {} }),
    fetchImpl: async () => {
      fetches += 1;
      return new Response("cached-qcow2-bytes");
    },
    execFile: async (command, args) => {
      calls.push([command, args]);
      if (command === "ssh-keygen-test") {
        await writeFile(args.at(-1), "private-key");
        await writeFile(`${args.at(-1)}.pub`, "ssh-ed25519 AAAAautomify test-key\n");
      }
      return { stdout: "", stderr: "" };
    }
  };

  let first;
  let second;
  try {
    first = await prepareDefaultQemuImage({ ...options, vmName: "automify-cache-one" });
    await first.close();
    second = await prepareDefaultQemuImage({ ...options, vmName: "automify-cache-two" });

    assert.equal(fetches, 1);
    assert.equal(first.baseImage, second.baseImage);
    assert.equal((await stat(second.baseImage)).size, "cached-qcow2-bytes".length);
    assert.equal(calls.filter(([command]) => command === "qemu-img-test").length, 2);
    assert.equal(calls.filter(([command]) => command === "ssh-keygen-test").length, 2);
  } finally {
    await first?.close();
    await second?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("QEMU prepared Debian image cache is reused across default VM overlays", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "automify-qemu-prepared-cache-"));
  const calls = [];
  const spawns = [];
  let fetches = 0;
  const options = {
    defaultImageCache: { dir: cacheDir },
    imageUrl: "https://example.test/debian-prepared.qcow2",
    qemuCommand: "qemu-system-test",
    qemuImgCommand: "qemu-img-test",
    sshKeygenCommand: "ssh-keygen-test",
    sshPort: 11026,
    createCloudInitServer: async () => ({ port: 18083, close: async () => {} }),
    fetchImpl: async () => {
      fetches += 1;
      return new Response("prepared-base-qcow2");
    },
    execFile: async (command, args) => {
      calls.push([command, args]);
      if (command === "qemu-img-test") {
        await writeFile(args.at(-1), "qcow2");
      }
      if (command === "ssh-keygen-test") {
        await writeFile(args.at(-1), "private-key");
        await writeFile(`${args.at(-1)}.pub`, "ssh-ed25519 AAAAautomify test-key\n");
      }
      return { stdout: "", stderr: "" };
    },
    spawn: (command, args, spawnOptions) => {
      spawns.push([command, args, spawnOptions]);
      return fakeChild();
    }
  };

  try {
    const first = await ensureDefaultQemuImageCache({ ...options, vmName: "automify-prepared-one" });
    const second = await ensureDefaultQemuImageCache({ ...options, vmName: "automify-prepared-two" });

    assert.equal(fetches, 1);
    assert.equal(first.baseImage, second.baseImage);
    assert.equal(first.preparedImage, second.preparedImage);
    assert.match(first.preparedImage, /prepared[/\\].*automify-prepared\.qcow2$/);
    assert.equal(calls.filter(([command]) => command === "ssh-keygen-test").length, 1);
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0][0], "qemu-system-test");
    assert.ok(spawns[0][1].some((arg) => String(arg).startsWith("file=/")));
    assert.ok((await stat(first.preparedImage)).size > 0);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("QEMU prepared image cache follows qemuImageCacheDir when configured", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "automify-qemu-prepared-custom-dir-"));
  const calls = [];
  const spawns = [];
  const options = {
    qemuImageCacheDir: cacheDir,
    imageUrl: "https://example.test/debian-prepared-custom.qcow2",
    qemuCommand: "qemu-system-test",
    qemuImgCommand: "qemu-img-test",
    sshKeygenCommand: "ssh-keygen-test",
    sshPort: 11027,
    createCloudInitServer: async () => ({ port: 18084, close: async () => {} }),
    fetchImpl: async () => new Response("prepared-custom-base"),
    execFile: async (command, args) => {
      calls.push([command, args]);
      if (command === "qemu-img-test") await writeFile(args.at(-1), "qcow2");
      if (command === "ssh-keygen-test") {
        await writeFile(args.at(-1), "private-key");
        await writeFile(`${args.at(-1)}.pub`, "ssh-ed25519 AAAAautomify test-key\n");
      }
      return { stdout: "", stderr: "" };
    },
    spawn: (command, args, spawnOptions) => {
      spawns.push([command, args, spawnOptions]);
      return fakeChild();
    }
  };

  try {
    const cache = await ensureDefaultQemuImageCache({ ...options, vmName: "automify-prepared-custom-dir" });

    assert.equal(cache.baseImage, join(cacheDir, "debian-prepared-custom.qcow2"));
    assert.match(cache.preparedImage, new RegExp(`${escapeRegExp(join(cacheDir, "prepared"))}`));
    assert.equal(spawns.length, 1);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("QemuCliSession uses the prepared image cache by default", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "automify-qemu-cli-prepared-default-"));
  const calls = [];
  const spawns = [];
  const session = new QemuCliSession({
    vmName: "automify-qemu-cli-prepared-default",
    sshPort: 11029,
    qemuImageCacheDir: cacheDir,
    qemuImageUrl: "https://example.test/debian-prepared-default.qcow2",
    qemuCommand: "qemu-system-test",
    qemuImgCommand: "qemu-img-test",
    accel: "hvf",
    sshKeygenCommand: "ssh-keygen-test",
    additionalAptPackages: ["coreutils"],
    createCloudInitServer: async () => ({ port: 18086, close: async () => {} }),
    fetchImpl: async () => new Response("prepared-default-base"),
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      if (command === "qemu-img-test") await writeFile(args.at(-1), "qcow2");
      if (command === "ssh-keygen-test") {
        await writeFile(args.at(-1), "private-key");
        await writeFile(`${args.at(-1)}.pub`, "ssh-ed25519 AAAAautomify test-key\n");
      }
      return { stdout: "", stderr: "" };
    },
    spawn: (command, args, spawnOptions) => {
      spawns.push([command, args, spawnOptions]);
      return fakeChild();
    }
  });

  try {
    await session.run("whoami");

    const runtimeArgs = spawns.at(-1)[1];
    assert.equal(spawns.at(-1)[0], "qemu-system-test");
    assert.ok(!runtimeArgs.includes("-incoming"));
    assert.ok(session.defaultImage.preparedImage.endsWith(".automify-prepared.qcow2"));
    assert.deepEqual(session.defaultImage.preparedPackages, ["coreutils"]);

    const prepareSetup = calls
      .find(([command, args]) => command === "ssh" && args.at(-1)?.includes?.("apt-get install"))[1]
      .at(-1);
    assert.match(prepareSetup, /apt-get install -y --no-install-recommends 'coreutils'/);
    assert.equal(
      calls.find(([command, args]) => command === "ssh" && args.at(-1)?.includes?.("apt-get install"))[2].timeout,
      300_000
    );

    const startup = calls.find(
      ([command, args]) => command === "ssh" && args.at(-1)?.includes?.("mkdir -p '\/workspace'")
    )[1].at(-1);
    assert.doesNotMatch(startup, /apt-get update/);
  } finally {
    await session.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("QemuCliSession rejects removed restore option", () => {
  const removedOption = "snap" + "shotRestore";
  assert.throws(
    () => new QemuCliSession({ [removedOption]: true }),
    new RegExp(`Unknown QEMU virtual CLI adapter option "${removedOption}"`)
  );
});

test("QEMU runtime wires firmware and CPU settings into the VM command", () => {
  const args = buildQemuArgs({
    image: "/tmp/runtime.qcow2",
    accel: "tcg",
    cpu: "host",
    firmware: "/tmp/QEMU_EFI.fd"
  });

  assert.equal(args[args.indexOf("-cpu") + 1], "host");
  assert.equal(args[args.indexOf("-bios") + 1], "/tmp/QEMU_EFI.fd");
});

test("QEMU firmware default honors explicit environment override", () => {
  assert.equal(defaultQemuFirmware({ AUTOMIFY_QEMU_FIRMWARE: "/tmp/firmware.fd" }), "/tmp/firmware.fd");
});

function fakeChild() {
  const child = new EventEmitter();
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    child.emit("exit", 0, signal);
    return true;
  };
  child.unref = () => {};
  return child;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
