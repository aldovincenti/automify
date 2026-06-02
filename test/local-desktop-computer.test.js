import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  captureLocalDesktopScreenshot,
  createLocalComputerAutomify,
  createLocalDesktopComputer,
  executeLocalDesktopAction
} from "../src/index.js";
import {
  DESKTOP_RUNTIME_MANIFEST,
  desktopRuntimeDir,
  desktopRuntimeManifest,
  resetDesktopRuntimeInstallState
} from "../src/lib/desktop-runtime.js";

test("createLocalDesktopComputer builds a desktop adapter around nut.js", async () => {
  const events = [];
  const nut = makeNut(events);
  const computer = await createLocalDesktopComputer({ nut, macosDisplayInfo: false, actionDelayMs: 0 });

  assert.equal(computer.displayWidth, 1440);
  assert.equal(computer.displayHeight, 900);
  assert.ok(["mac", "windows", "ubuntu"].includes(computer.environment));
  assert.match(computer.instructions, /native desktop/);
  assert.match(computer.instructions, /Do not open or use Command\+Tab/);
  assert.match(computer.instructions, /Do not click as a probe/);
  assert.match(computer.instructions, /Use deterministic entry points/);
  assert.match(computer.instructions, /confirm the terminal is idle and showing a prompt/);

  await computer.execute({ type: "click", x: 10, y: 20, button: "right" });
  await computer.execute({ type: "type", text: "hello" });

  assert.deepEqual(events.slice(-3), [
    ["move", { x: 10, y: 20 }],
    ["click", "right"],
    ["type", "hello"]
  ]);

  await computer.close();
});

test("createLocalDesktopComputer accepts grouped viewport, mouse, and keyboard options", async () => {
  const events = [];
  const nut = makeNut(events);
  const computer = await createLocalDesktopComputer({
    nut,
    viewport: { width: 1000, height: 600 },
    mouse: { autoDelayMs: 0, configure: true },
    keyboard: { autoDelayMs: 0, configure: true },
    macosDisplayInfo: false,
    actionDelayMs: 0
  });

  assert.equal(computer.displayWidth, 1000);
  assert.equal(computer.displayHeight, 600);

  await computer.close();
});

test("createLocalDesktopComputer normalizes documented OS environment aliases", async () => {
  const mac = await createLocalDesktopComputer({
    nut: makeNut([]),
    environment: "macOS",
    macosDisplayInfo: false
  });

  assert.equal(mac.environment, "mac");

  await mac.close();

  const linux = await createLocalDesktopComputer({
    nut: makeNut([]),
    environment: "Fedora",
    macosDisplayInfo: false
  });

  assert.equal(linux.environment, "linux");

  await linux.close();
});

test("createLocalDesktopComputer explains unsupported local desktop environments", async () => {
  await assert.rejects(
    () =>
      createLocalDesktopComputer({
        nut: makeNut([]),
        environment: "macOS desktop"
      }),
    /Unsupported local desktop environment "macOS desktop".*Use "mac" for macOS.*"linux" for Linux.*"ubuntu" is also accepted for compatibility.*Use instructions for OS-specific guidance/s
  );
});

test("createLocalDesktopComputer prevents concurrent local desktop adapters", async () => {
  const first = await createLocalDesktopComputer({
    nut: makeNut([]),
    macosDisplayInfo: false
  });

  await assert.rejects(
    () =>
      createLocalDesktopComputer({
        nut: makeNut([]),
        macosDisplayInfo: false
      }),
    /local desktop adapter is already in use/
  );

  await first.close();

  const second = await createLocalDesktopComputer({
    nut: makeNut([]),
    macosDisplayInfo: false
  });
  await second.close();
});

test("createLocalDesktopComputer releases the lock when setup fails", async () => {
  const brokenNut = makeNut([]);
  brokenNut.screen.capture = async () => {
    throw new Error("capture failed");
  };

  await assert.rejects(
    () =>
      createLocalDesktopComputer({
        nut: brokenNut,
        macosDisplayInfo: false
      }),
    /capture failed/
  );

  const computer = await createLocalDesktopComputer({
    nut: makeNut([]),
    macosDisplayInfo: false
  });
  await computer.close();
});

test("createLocalComputerAutomify creates a closeable local desktop runner", async () => {
  const events = [];
  const runner = await createLocalComputerAutomify({
    client: {
      async createResponse() {
        return { id: "resp_done", output: [] };
      }
    },
    model: "test-model",
    nut: makeNut(events),
    macosDisplayInfo: false
  });

  assert.equal(runner.client.createResponse instanceof Function, true);
  await runner.close();
});

test("createLocalDesktopComputer starts Xvfb on headless Linux when requested", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux-only virtual display behavior.");
    return;
  }

  const events = [];
  const env = {};
  const child = new EventEmitter();
  child.pid = 123;
  child.killed = false;
  child.kill = (signal) => {
    events.push(["kill", signal]);
    child.killed = true;
  };
  child.unref = () => events.push(["unref"]);

  const computer = await createLocalDesktopComputer({
    nut: makeNut(events),
    env,
    forceVirtualDisplay: true,
    virtualDisplayStartupMs: 0,
    spawn(command, args) {
      events.push(["spawn", command, args]);
      return child;
    },
    macosDisplayInfo: false
  });

  assert.equal(env.DISPLAY, ":99");
  assert.deepEqual(events[0], ["spawn", "Xvfb", [":99", "-screen", "0", "1440x900x24", "-nolisten", "tcp"]]);

  await computer.close();
  assert.deepEqual(events.at(-1), ["kill", "SIGTERM"]);
});

test("executeLocalDesktopAction maps common computer actions to nut.js", async () => {
  const events = [];
  const nut = makeNut(events);

  await executeLocalDesktopAction({ type: "double_click", x: 1, y: 2 }, { nut });
  await executeLocalDesktopAction({ type: "scroll", x: 3, y: 4, scroll_y: 240 }, { nut });
  await executeLocalDesktopAction({ type: "keypress", keys: ["Control", "S"] }, { nut });
  await executeLocalDesktopAction({ type: "move", x: 5, y: 6 }, { nut });
  await executeLocalDesktopAction(
    {
      type: "drag",
      path: [
        { x: 7, y: 8 },
        { x: 9, y: 10 }
      ]
    },
    { nut }
  );
  await executeLocalDesktopAction({ type: "wait", ms: 1 }, { nut });
  await executeLocalDesktopAction({ type: "screenshot" }, { nut });

  assert.deepEqual(events, [
    ["move", { x: 1, y: 2 }],
    ["doubleClick", "left"],
    ["move", { x: 3, y: 4 }],
    ["scrollDown", 2],
    ["pressKey", "ctrl", "s"],
    ["releaseKey", "ctrl", "s"],
    ["move", { x: 5, y: 6 }],
    ["move", { x: 7, y: 8 }],
    ["drag", { x: 9, y: 10 }]
  ]);
});

test("createLocalDesktopComputer scales retina screenshot coordinates to macOS mouse points", async () => {
  const events = [];
  const nut = makeNut(events);
  nut.screen.width = async () => 2940;
  nut.screen.height = async () => 1912;
  nut.saveImage = async (_image, path) => {
    events.push(["saveImage"]);
    await writeFile(path, pngHeader(2940, 1912));
  };

  const computer = await createLocalDesktopComputer({ nut, environment: "mac", macosDisplayInfo: false });

  assert.equal(computer.displayWidth, 2940);
  assert.equal(computer.displayHeight, 1912);

  await computer.execute({ type: "move", x: 1470, y: 1850 });

  assert.deepEqual(events.at(-1), ["move", { x: 735, y: 925 }]);

  await computer.close();
});

test("createLocalDesktopComputer uses macOS point dimensions when available", async () => {
  const events = [];
  const nut = makeNut(events);
  nut.screen.width = async () => 2940;
  nut.screen.height = async () => 1912;
  nut.saveImage = async (_image, path) => {
    events.push(["saveImage"]);
    await writeFile(path, pngHeader(5880, 3824));
  };

  const computer = await createLocalDesktopComputer({
    nut,
    environment: "mac",
    macosDisplayInfo: {
      width: 1470,
      height: 956,
      backingScaleFactor: 2
    }
  });

  assert.equal(computer.displayWidth, 5880);
  assert.equal(computer.displayHeight, 3824);

  await computer.execute({ type: "move", x: 2940, y: 3700 });

  assert.deepEqual(events.at(-1), ["move", { x: 735, y: 925 }]);

  await computer.close();
});

test("createLocalDesktopComputer scales high-DPI Windows screenshot coordinates to mouse points", async () => {
  const events = [];
  const nut = makeNut(events);
  nut.screen.width = async () => 1440;
  nut.screen.height = async () => 900;
  nut.saveImage = async (_image, path) => {
    events.push(["saveImage"]);
    await writeFile(path, pngHeader(2880, 1800));
  };

  const computer = await createLocalDesktopComputer({
    nut,
    environment: "windows"
  });

  assert.equal(computer.displayWidth, 2880);
  assert.equal(computer.displayHeight, 1800);

  await computer.execute({ type: "move", x: 2062, y: 1754 });

  assert.deepEqual(events.at(-1), ["move", { x: 1031, y: 877 }]);

  await computer.close();
});

test("executeLocalDesktopAction allows macOS app switching shortcuts", async () => {
  const events = [];
  const nut = makeNut(events);

  await executeLocalDesktopAction(
    { type: "keypress", keys: ["Command", "Tab"] },
    { nut, environment: "mac", macCommandTabSettleMs: 0, macCommandTabHoldMs: 0 }
  );
  await executeLocalDesktopAction({ type: "keypress", keys: ["Control", "Up"] }, { nut, environment: "mac" });

  assert.deepEqual(events, [
    ["pressKey", "cmd"],
    ["pressKey", "tab"],
    ["releaseKey", "tab"],
    ["releaseKey", "cmd"],
    ["pressKey", "ctrl", "up"],
    ["releaseKey", "ctrl", "up"]
  ]);
});

test("executeLocalDesktopAction uses instant mouse positioning when available", async () => {
  const events = [];
  const nut = makeNut(events);
  nut.mouse.config = { autoDelayMs: 100, mouseSpeed: 1000 };
  nut.mouse.setPosition = async (target) => {
    events.push(["setPosition", { x: target.x, y: target.y }]);
  };

  await executeLocalDesktopAction({ type: "click", x: 11, y: 22, button: "left" }, { nut });

  assert.deepEqual(events, [
    ["setPosition", { x: 11, y: 22 }],
    ["click", "left"]
  ]);
  assert.equal(nut.mouse.config.autoDelayMs, 0);
});

test("executeLocalDesktopAction removes nut.js keyboard delay by default", async () => {
  const events = [];
  const nut = makeNut(events);
  nut.keyboard.config = { autoDelayMs: 300 };

  await executeLocalDesktopAction({ type: "keypress", keys: ["Control", "S"] }, { nut });

  assert.equal(nut.keyboard.config.autoDelayMs, 0);
  assert.deepEqual(events, [
    ["pressKey", "ctrl", "s"],
    ["releaseKey", "ctrl", "s"]
  ]);
});

test("executeLocalDesktopAction emits debug events", async () => {
  const events = [];
  const logs = [];
  const nut = makeNut(events);

  await executeLocalDesktopAction(
    { type: "click", x: 11, y: 22, button: "left" },
    {
      nut,
      debug(message, details) {
        logs.push([message, details]);
      }
    }
  );

  assert.equal(logs[0][0], "[automify:local-desktop] action");
  assert.deepEqual(logs[0][1].action, { type: "click", x: 11, y: 22, button: "left" });
  assert.equal(logs[1][0], "[automify:local-desktop] move");
  assert.deepEqual(logs[1][1].input, { x: 11, y: 22 });
  assert.deepEqual(logs[1][1].output, { x: 11, y: 22 });
  assert.equal(logs[1][1].coordinateSpace, null);
});

test("executeLocalDesktopAction writes local desktop events to logFile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-local-desktop-logs-"));
  const logFile = join(dir, "local-desktop.jsonl");

  await executeLocalDesktopAction(
    { type: "click", x: 11, y: 22, button: "left" },
    {
      nut: makeNut([]),
      logFile
    }
  );

  const events = (await readFile(logFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.scope === "automify:local-desktop" && event.message === "action"));
  assert.ok(events.some((event) => event.scope === "automify:local-desktop" && event.message === "move"));
});

test("executeLocalDesktopAction defaults debug to false", async () => {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);

  try {
    await executeLocalDesktopAction({ type: "click", x: 11, y: 22, button: "left" }, { nut: makeNut([]) });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(logs, []);
});

test("executeLocalDesktopAction can silence logs", async () => {
  const logs = [];

  await executeLocalDesktopAction(
    { type: "click", x: 11, y: 22, button: "left" },
    {
      nut: makeNut([]),
      silent: true,
      debug(message, details) {
        logs.push([message, details]);
      }
    }
  );

  assert.deepEqual(logs, []);
});

test("captureLocalDesktopScreenshot saves nut.js image objects as PNG bytes", async () => {
  const events = [];
  const nut = makeNut(events);
  const screenshot = await captureLocalDesktopScreenshot({ nut });

  assert.equal(screenshot.toString(), "png-bytes");
  assert.equal(events[0][0], "capture");
  assert.equal(events[1][0], "saveImage");
});

test("captureLocalDesktopScreenshot loads nut.js from the persistent desktop runtime cache", async () => {
  const previousRuntimeDir = process.env.AUTOMIFY_DESKTOP_RUNTIME_DIR;
  const runtimeRoot = await mkdtemp(join(tmpdir(), "automify-desktop-runtime-"));
  process.env.AUTOMIFY_DESKTOP_RUNTIME_DIR = runtimeRoot;

  try {
    const runtimeDir = desktopRuntimeDir();
    const packageDir = join(runtimeDir, "node_modules", "@nut-tree", "nut-js");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(runtimeDir, DESKTOP_RUNTIME_MANIFEST),
      `${JSON.stringify(desktopRuntimeManifest(), null, 2)}\n`
    );
    await writeFile(
      join(packageDir, "package.json"),
      `${JSON.stringify({ name: "@nut-tree/nut-js", version: "0.0.0", main: "index.js" }, null, 2)}\n`
    );
    await writeFile(
      join(packageDir, "index.js"),
      `const { writeFileSync } = require("node:fs");
module.exports = {
  screen: {
    async capture() {
      return { width: 1, height: 1 };
    }
  },
  async saveImage(_image, path) {
    writeFileSync(path, Buffer.from("cached-png-bytes"));
  }
};
`
    );

    const screenshot = await captureLocalDesktopScreenshot();

    assert.equal(screenshot.toString(), "cached-png-bytes");
  } finally {
    if (previousRuntimeDir == null) {
      delete process.env.AUTOMIFY_DESKTOP_RUNTIME_DIR;
    } else {
      process.env.AUTOMIFY_DESKTOP_RUNTIME_DIR = previousRuntimeDir;
    }
  }
});

test("resetDesktopRuntimeInstallState removes stale nut.js packages before reinstalling runtime dependencies", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "automify-desktop-runtime-reset-"));
  const env = { ...process.env, AUTOMIFY_DESKTOP_RUNTIME_DIR: runtimeRoot };
  const runtimeDir = desktopRuntimeDir(env);
  const staleNutPackage = join(runtimeDir, "node_modules", "@nut-tree", "nut-js", "package.json");
  const runtimeDependency = join(runtimeDir, "node_modules", "jimp", "package.json");

  await mkdir(join(runtimeDir, "node_modules", "@nut-tree", "nut-js"), { recursive: true });
  await mkdir(join(runtimeDir, "node_modules", "jimp"), { recursive: true });
  await writeFile(staleNutPackage, `${JSON.stringify({ dependencies: { "@nut-tree/shared": "workspace:*" } })}\n`);
  await writeFile(runtimeDependency, `${JSON.stringify({ name: "jimp" })}\n`);
  await writeFile(join(runtimeDir, "package-lock.json"), "{}\n");
  await writeFile(join(runtimeDir, "npm-shrinkwrap.json"), "{}\n");

  resetDesktopRuntimeInstallState(env);

  assert.equal(existsSync(staleNutPackage), false);
  assert.equal(existsSync(join(runtimeDir, "node_modules", "@nut-tree")), false);
  assert.equal(existsSync(join(runtimeDir, "package-lock.json")), false);
  assert.equal(existsSync(join(runtimeDir, "npm-shrinkwrap.json")), false);
  assert.equal(existsSync(runtimeDependency), true);
});

test("install-desktop skips when the persistent desktop runtime cache is compatible", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "automify-desktop-runtime-skip-"));
  const env = { ...process.env, AUTOMIFY_DESKTOP_RUNTIME_DIR: runtimeRoot };
  const runtimeDir = desktopRuntimeDir(env);
  const packageDir = join(runtimeDir, "node_modules", "@nut-tree", "nut-js");

  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(runtimeDir, DESKTOP_RUNTIME_MANIFEST),
    `${JSON.stringify(desktopRuntimeManifest(env), null, 2)}\n`
  );
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify({ name: "@nut-tree/nut-js" }, null, 2)}\n`
  );

  const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "install-desktop.js")], {
    cwd: process.cwd(),
    env,
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /already installed and compatible; skipping rebuild/);
  assert.match(result.stdout, /--force/);
  assert.equal(result.stderr, "");
});

test("captureLocalDesktopScreenshot supports public nut.js file capture API", async () => {
  const events = [];
  const nut = makeNut(events);
  delete nut.saveImage;
  nut.FileType = { PNG: "png" };
  nut.screen.capture = async (filename, format, filePath) => {
    events.push(["captureFile", filename, format, filePath]);
    const path = join(filePath, `${filename}.png`);
    await writeFile(path, Buffer.from("legacy-png-bytes"));
    return path;
  };

  const screenshot = await captureLocalDesktopScreenshot({ nut });

  assert.equal(screenshot.toString(), "legacy-png-bytes");
  assert.equal(events[0][0], "captureFile");
  assert.equal(events[0][2], "png");
  assert.ok(events[0][3]);
});

test("captureLocalDesktopScreenshot adds OS-specific help when capture fails", async () => {
  const nut = makeNut([]);
  nut.screen.capture = async () => {
    throw new Error("permission denied");
  };

  await assert.rejects(
    () => captureLocalDesktopScreenshot({ nut, environment: "mac" }),
    /local desktop screenshot capture failed.*Screen Recording and Accessibility permissions.*Original error: permission denied/s
  );
});

test("createLocalDesktopComputer validates grouped option names", async () => {
  await assert.rejects(
    () => createLocalDesktopComputer({ nut: makeNut([]), mouse: { autoDelay: 10 } }),
    /Unknown local desktop mouse option "autoDelay". Did you mean "autoDelayMs"\?/
  );
});

function makeNut(events) {
  return {
    Button: {
      LEFT: "left",
      MIDDLE: "middle",
      RIGHT: "right"
    },
    Key: {
      LeftControl: "ctrl",
      LeftCmd: "cmd",
      LeftSuper: "command",
      Tab: "tab",
      Up: "up",
      F3: "f3",
      S: "s"
    },
    Point: class Point {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
    },
    keyboard: {
      async pressKey(...keys) {
        events.push(["pressKey", ...keys]);
      },
      async releaseKey(...keys) {
        events.push(["releaseKey", ...keys]);
      },
      async type(text) {
        events.push(["type", text]);
      }
    },
    mouse: {
      async click(button) {
        events.push(["click", button]);
      },
      async doubleClick(button) {
        events.push(["doubleClick", button]);
      },
      async drag(path) {
        events.push(["drag", path.target]);
      },
      async move(path) {
        events.push(["move", path.target]);
      },
      async scrollDown(amount) {
        events.push(["scrollDown", amount]);
      },
      async scrollLeft(amount) {
        events.push(["scrollLeft", amount]);
      },
      async scrollRight(amount) {
        events.push(["scrollRight", amount]);
      },
      async scrollUp(amount) {
        events.push(["scrollUp", amount]);
      }
    },
    async saveImage(_image, path) {
      events.push(["saveImage"]);
      await writeFile(path, Buffer.from("png-bytes"));
    },
    screen: {
      async capture(filename, format, filePath) {
        events.push(["capture", filename, format, filePath]);
        return { height: 1, width: 1 };
      },
      async height() {
        return 900;
      },
      async width() {
        return 1440;
      }
    },
    straightTo(target) {
      return {
        target: {
          x: target.x,
          y: target.y
        }
      };
    }
  };
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
