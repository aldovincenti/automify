import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createVirtualDesktopComputer } from "../src/index.js";

test("createVirtualDesktopComputer starts a QEMU desktop VM over SSH", async () => {
  const calls = [];
  const spawns = [];
  const computer = await createVirtualDesktopComputer({
    image: "/tmp/automify-desktop.qcow2",
    vmName: "automify-qemu-desktop",
    startupCommand: "xterm",
    sshPort: 10022,
    startupTimeoutMs: 1000,
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      return { stdout: Buffer.from("") };
    },
    spawn: (command, args, options) => {
      spawns.push([command, args, options]);
      return fakeChild();
    }
  });

  assert.equal(computer.displayWidth, 1440);
  assert.equal(computer.displayHeight, 900);
  assert.equal(computer.environment, "linux");
  assert.match(computer.instructions, /QEMU virtual machine/);

  const qemuArgs = spawns[0][1];
  assert.match(spawns[0][0], /^qemu-system-/);
  assert.equal(qemuArgs[qemuArgs.indexOf("-name") + 1], "automify-qemu-desktop");
  assert.ok(qemuArgs.includes("file=/tmp/automify-desktop.qcow2,if=virtio,format=qcow2"));
  assert.ok(qemuArgs.includes("user,id=net0,hostfwd=tcp:127.0.0.1:10022-:22"));

  const startup = calls.find(([, args]) => args.at(-1)?.includes?.("automify-desktop-supervisor"))[1].at(-1);
  assert.match(startup, /apt-get update/);
  assert.match(startup, /Xvfb/);
  assert.match(startup, /xterm/);

  await computer.close();
  assert.equal(computer.session.process.killed, true);
});

test("QEMU virtual desktop maps computer actions to xdotool over SSH", async () => {
  const calls = [];
  const computer = await createVirtualDesktopComputer({
    start: false,
    existingVM: true,
    vmName: "existing-qemu",
    startupCommand: "xterm",
    sshPort: 10023,
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
  assert.equal(calls[0][0], "ssh");
  assert.deepEqual(calls[0][1].slice(0, 2), ["-p", "10023"]);
  assert.match(calls[0][1].at(-1), /DISPLAY=':99' 'xdotool' 'mousemove' '10' '21' 'click' '3'/);
  assert.match(calls[1][1].at(-1), /'xdotool' 'type' '--clearmodifiers' '--' 'hello'/);
  assert.match(calls[2][1].at(-1), /scrot -o -/);

  await computer.close();
});

test("createVirtualDesktopComputer exposes shared folders through QEMU virtfs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-qemu-desktop-test-"));
  const source = join(dir, "input.txt");
  await writeFile(source, "hello desktop");
  const spawns = [];

  const computer = await createVirtualDesktopComputer({
    image: "/tmp/shared-desktop.qcow2",
    vmName: "automify-qemu-shared",
    startupCommand: "xterm",
    sshPort: 10024,
    sharedFolder: {
      containerPath: "/shared",
      files: [{ path: source, targetPath: "docs/input.txt" }]
    },
    execFile: async () => ({ stdout: Buffer.from("") }),
    spawn: (command, args, options) => {
      spawns.push([command, args, options]);
      return fakeChild();
    }
  });

  const qemuArgs = spawns[0][1];
  const virtfs = qemuArgs[qemuArgs.indexOf("-virtfs") + 1];
  assert.match(virtfs, /mount_tag=automify_shared/);
  assert.equal(computer.sharedFolder.containerPath, "/shared");
  assert.equal(computer.sharedFolder.files[0].containerPath, "/shared/docs/input.txt");

  await computer.close();
});

test("createVirtualDesktopComputer uses the default Debian image when no image is configured", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "automify-qemu-desktop-cache-"));
  const calls = [];
  const spawns = [];
  const computer = await createVirtualDesktopComputer({
    vmName: "automify-qemu-desktop-default",
    startupCommand: "xterm",
    sshPort: 10025,
    startupTimeoutMs: 1000,
    qemuImageCacheDir: cacheDir,
    qemuImageUrl: "https://example.test/debian.qcow2",
    defaultImageCache: false,
    qemuImgCommand: "qemu-img-test",
    sshKeygenCommand: "ssh-keygen-test",
    createCloudInitServer: async () => ({ port: 18081, close: async () => {} }),
    fetchImpl: async () => new Response("qcow2-bytes"),
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      if (command === "ssh-keygen-test") {
        await writeFile(`${args.at(-1)}.pub`, "ssh-ed25519 AAAAautomify test-key\n");
      }
      return { stdout: Buffer.from("") };
    },
    spawn: (command, args, options) => {
      spawns.push([command, args, options]);
      return fakeChild();
    }
  });

  try {
    assert.ok(calls.some(([command]) => command === "qemu-img-test"));
    assert.ok(calls.some(([command]) => command === "ssh-keygen-test"));
    const qemuArgs = spawns[0][1];
    assert.match(qemuArgs[qemuArgs.indexOf("-drive") + 1], /automify-qemu-debian-.*disk\.qcow2/);
    assert.match(qemuArgs[qemuArgs.indexOf("-smbios") + 1], /ds=nocloud-net;s=http:\/\/10\.0\.2\.2:18081\//);

    const startup = calls.find(([, args]) => args.at(-1)?.includes?.("automify-desktop-supervisor"))[1].at(-1);
    assert.match(startup, /sudo -n apt-get update/);
    assert.ok(calls.some(([, args]) => args.some((arg) => /^automify@127\.0\.0\.1$/.test(arg))));
  } finally {
    await computer.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("createVirtualDesktopComputer bakes desktop packages into the prepared image cache", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "automify-qemu-desktop-prepared-cache-"));
  const calls = [];
  const spawns = [];
  const computer = await createVirtualDesktopComputer({
    vmName: "automify-qemu-desktop-prepared",
    startupCommand: "xterm",
    sshPort: 10026,
    startupTimeoutMs: 1000,
    qemuImageCacheDir: cacheDir,
    qemuImageUrl: "https://example.test/debian-desktop-prepared.qcow2",
    qemuCommand: "qemu-system-test",
    qemuImgCommand: "qemu-img-test",
    sshKeygenCommand: "ssh-keygen-test",
    createCloudInitServer: async () => ({ port: 18082, close: async () => {} }),
    fetchImpl: async () => new Response("desktop-prepared-base"),
    execFile: async (command, args, options) => {
      calls.push([command, args, options]);
      if (command === "qemu-img-test") await writeFile(args.at(-1), "qcow2");
      if (command === "ssh-keygen-test") {
        await writeFile(args.at(-1), "private-key");
        await writeFile(`${args.at(-1)}.pub`, "ssh-ed25519 AAAAautomify test-key\n");
      }
      return { stdout: Buffer.from("") };
    },
    spawn: (command, args, options) => {
      spawns.push([command, args, options]);
      return fakeChild();
    }
  });

  try {
    assert.equal(spawns.length, 2);
    assert.match(computer.session.defaultImage.preparedImage, /prepared[/\\].*-desktop-.*automify-prepared\.qcow2$/);
    assert.deepEqual(computer.session.defaultImage.preparedPackages.slice(0, 3), ["xvfb", "openbox", "xterm"]);

    const prepareSetup = calls
      .find(([command, args]) => command === "ssh" && args.at(-1)?.includes?.("apt-get install"))[1]
      .at(-1);
    assert.match(prepareSetup, /apt-get install -y --no-install-recommends 'xvfb'/);
    assert.match(prepareSetup, /'xdotool'/);

    const startup = calls.find(([, args]) => args.at(-1)?.includes?.("automify-desktop-supervisor"))[1].at(-1);
    assert.doesNotMatch(startup, /apt-get update/);
    assert.match(startup, /Xvfb/);
    assert.match(startup, /xterm/);
  } finally {
    await computer.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
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
