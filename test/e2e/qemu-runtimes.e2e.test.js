import assert from "node:assert/strict";
import { test } from "node:test";

import { QemuCliSession } from "../../src/index.js";

const shouldRunQemuDebian = process.env.RUN_QEMU_DEBIAN_E2E === "1";

test(
  "e2e: QEMU virtual CLI boots the cached default Debian image when enabled",
  { skip: !shouldRunQemuDebian, timeout: 600_000 },
  async () => {
    const session = new QemuCliSession({
      ...qemuDebianOptionsFromEnv(),
      vmName: `automify-e2e-qemu-debian-${Date.now()}`,
      startupTimeoutMs: 300_000,
      timeoutMs: 60_000
    });

    try {
      const { stdout } = await session.run("cat /etc/os-release && uname -m");

      assert.match(stdout, /^ID=debian$/m);
      assert.match(stdout, /^VERSION_ID="\d+"$/m);
      assert.match(stdout, /\n\S+\s*$/);
      assert.ok(session.defaultImage.preparedImage.endsWith(".automify-prepared.qcow2"));
    } finally {
      await session.close();
    }
  }
);

function qemuDebianOptionsFromEnv() {
  const vm = {
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

  const options = {
    vm,
    qemuCommand: process.env.AUTOMIFY_QEMU_COMMAND,
    qemuImgCommand: process.env.AUTOMIFY_QEMU_IMG_COMMAND,
    qemuImageCacheDir: process.env.AUTOMIFY_QEMU_IMAGE_CACHE_DIR,
    qemuImageUrl: process.env.AUTOMIFY_QEMU_DEFAULT_IMAGE_URL
  };
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === "") delete options[key];
  }
  return options;
}
