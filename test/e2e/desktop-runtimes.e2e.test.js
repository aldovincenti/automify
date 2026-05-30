import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createComputerAutomify, createLocalDesktopComputer, createDockerDesktopComputer } from "../../src/index.js";

test("e2e: Docker desktop sandbox runs a complete computer-use loop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-e2e-virtual-final-"));
  const finalScreenshot = join(dir, "final.png");
  const dockerCalls = [];
  const desktop = {
    pointer: { x: 0, y: 0 },
    typed: "",
    screenshots: 0
  };
  const computer = await createDockerDesktopComputer({
    containerName: "automify-e2e-virtual",
    startupCommand: "xterm",
    execFile: async (command, args, options) => {
      dockerCalls.push({ command, args, options });
      return handleFakeDockerExec(args, desktop);
    }
  });
  const modelCalls = [];
  const automify = createComputerAutomify({
    client: scriptedClient(
      modelCalls,
      [
        { type: "click", x: 120, y: 80, button: "left" },
        { type: "type", text: "Docker desktop e2e" },
        { type: "keypress", keys: ["Enter"] },
        { type: "screenshot" }
      ],
      () =>
        JSON.stringify({
          pointer: desktop.pointer,
          typed: desktop.typed,
          screenshots: desktop.screenshots
        })
    ),
    computer,
    model: "test-docker-desktop-model"
  });

  try {
    const result = await automify.do("Type a line in the isolated Linux desktop.", {
      finalScreenshot,
      output: {
        type: "json_schema",
        name: "virtual_desktop_result",
        schema: {
          type: "object",
          properties: {
            pointer: {
              type: "object",
              properties: {
                x: { type: "integer" },
                y: { type: "integer" }
              },
              required: ["x", "y"],
              additionalProperties: false
            },
            typed: { type: "string" },
            screenshots: { type: "integer" }
          },
          required: ["pointer", "typed", "screenshots"],
          additionalProperties: false
        }
      }
    });

    const finalScreenshotBytes = await readFile(finalScreenshot);
    assert.equal(result.completed, true);
    assert.deepEqual(result.finalScreenshot, {
      path: finalScreenshot,
      bytes: finalScreenshotBytes.byteLength
    });
    assert.equal(result.steps.length, 4);
    assert.deepEqual(result.parsed, {
      pointer: { x: 120, y: 80 },
      typed: "Docker desktop e2e\n",
      screenshots: 3
    });
    assert.equal(desktop.screenshots, 4);
    assert.equal(finalScreenshotBytes[0], 0x89);
    assert.equal(finalScreenshotBytes[1], 0x50);

    const run = dockerCalls.find((call) => call.args[0] === "run")?.args;
    assert.ok(run, "expected Docker run to be called");
    assert.ok(hasArgPair(run, "--network", "bridge"));
    assert.equal(run.includes("--cap-drop"), false);
    assert.equal(run.includes("--read-only"), false);
    assert.ok(run.includes("--tmpfs"));

    assert.ok(dockerCalls.some((call) => call.args.includes("xdpyinfo >/dev/null 2>&1")));
    assert.ok(dockerCalls.some((call) => call.args.includes("xdotool") && call.args.includes("click")));
    assert.ok(dockerCalls.some((call) => call.args.includes("xdotool") && call.args.includes("type")));
    assert.ok(
      dockerCalls.some((call) => call.args.includes("scrot -o - 2>/dev/null || import -window root -screen png:-"))
    );
  } finally {
    await computer.close();
    await rm(dir, { recursive: true, force: true });
  }

  assert.deepEqual(dockerCalls.at(-1).args, ["rm", "-f", "automify-e2e-virtual"]);
});

test("e2e: local desktop adapter drives the model loop with a native dependency shim", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-e2e-local-final-"));
  const finalScreenshot = join(dir, "final.png");
  const events = [];
  const nut = makeNut(events);
  const computer = await createLocalDesktopComputer({
    nut,
    macosDisplayInfo: false,
    calibrateScreenshot: false,
    actionDelayMs: 0
  });
  const modelCalls = [];
  const automify = createComputerAutomify({
    client: scriptedClient(
      modelCalls,
      [
        { type: "click", x: 15, y: 25, button: "left" },
        { type: "type", text: "local desktop e2e" },
        { type: "keypress", keys: ["Enter"] }
      ],
      () =>
        JSON.stringify({
          typed: nut.state.typed,
          clicked: nut.state.clicked,
          screenshots: nut.state.screenshots
        })
    ),
    computer,
    model: "test-local-desktop-model"
  });

  try {
    const result = await automify.do("Click the editor and type a line.", {
      finalScreenshot,
      output: {
        type: "json_schema",
        name: "local_desktop_result",
        schema: {
          type: "object",
          properties: {
            typed: { type: "string" },
            clicked: { type: "boolean" },
            screenshots: { type: "integer" }
          },
          required: ["typed", "clicked", "screenshots"],
          additionalProperties: false
        }
      }
    });

    const finalScreenshotBytes = await readFile(finalScreenshot);
    assert.equal(result.completed, true);
    assert.deepEqual(result.finalScreenshot, {
      path: finalScreenshot,
      bytes: finalScreenshotBytes.byteLength
    });
    assert.deepEqual(result.parsed, {
      typed: "local desktop e2e\n",
      clicked: true,
      screenshots: 3
    });
    assert.equal(nut.state.screenshots, 4);
    assert.equal(finalScreenshotBytes[0], 0x89);
    assert.equal(finalScreenshotBytes[1], 0x50);
    assert.deepEqual(
      events.filter((event) => ["move", "click", "type", "pressKey"].includes(event[0])),
      [
        ["move", { x: 15, y: 25 }],
        ["click", "left"],
        ["type", "local desktop e2e"],
        ["pressKey", "enter"]
      ]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("e2e: local desktop starts and closes Xvfb on Linux headless hosts", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux-only Xvfb bootstrap behavior.");
    return;
  }

  const events = [];
  const env = {};
  const child = new EventEmitter();
  child.pid = 4242;
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
    calibrateScreenshot: false,
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

test("e2e: Docker desktop can smoke-test a real Docker image when enabled", async (t) => {
  const image = process.env.AUTOMIFY_VIRTUAL_DESKTOP_IMAGE;
  if (!image) {
    t.skip("Set AUTOMIFY_VIRTUAL_DESKTOP_IMAGE to smoke-test a real Docker desktop container.");
    return;
  }

  const computer = await createDockerDesktopComputer({
    image,
    containerName: `automify-e2e-real-${Date.now()}`,
    startupTimeoutMs: 180_000,
    additionalAptPackages: ["chromium"],
    startupCommand:
      "chromium --no-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --no-default-browser-check about:blank"
  });

  try {
    const { stdout } = await computer.session.exec(["sh", "-lc", "chromium --version"], { encoding: "utf8" });
    assert.match(stdout, /Chromium/i);

    await computer.execute({ type: "move", x: 10, y: 10 });
    await computer.execute({ type: "click", x: 10, y: 10 });
    const screenshot = Buffer.from(await computer.screenshot());

    assert.equal(screenshot[0], 0x89);
    assert.equal(screenshot[1], 0x50);
    assert.equal(screenshot[2], 0x4e);
    assert.equal(screenshot[3], 0x47);
  } finally {
    await computer.close();
  }
});

function scriptedClient(calls, actions, finalText) {
  return {
    async createResponse(payload) {
      const index = calls.length;
      calls.push(payload);

      if (index >= actions.length) {
        const text = typeof finalText === "function" ? finalText() : finalText;
        return {
          id: `resp_${index}`,
          output: [{ type: "message", content: [{ type: "output_text", text }] }]
        };
      }

      return {
        id: `resp_${index}`,
        output: [
          {
            type: "computer_call",
            call_id: `call_${index}`,
            action: actions[index],
            pending_safety_checks: []
          }
        ]
      };
    }
  };
}

function handleFakeDockerExec(args, desktop) {
  if (args[0] === "run") {
    return { stdout: Buffer.from("container-id") };
  }
  if (args[0] === "rm") {
    return { stdout: Buffer.from("") };
  }
  if (args.includes("xdpyinfo >/dev/null 2>&1")) {
    return { stdout: Buffer.from("") };
  }
  if (args.includes("scrot -o - 2>/dev/null || import -window root -screen png:-")) {
    desktop.screenshots += 1;
    return { stdout: pngHeader(1440, 900) };
  }

  const xdotoolIndex = args.indexOf("xdotool");
  if (xdotoolIndex >= 0) {
    const command = args.slice(xdotoolIndex + 1);
    applyXdotool(command, desktop);
  }
  return { stdout: Buffer.from("") };
}

function applyXdotool(command, desktop) {
  const mouseIndex = command.indexOf("mousemove");
  if (mouseIndex >= 0) {
    desktop.pointer = {
      x: Number(command[mouseIndex + 1]),
      y: Number(command[mouseIndex + 2])
    };
  }
  if (command[0] === "type") {
    desktop.typed += command.at(-1);
  }
  if (command[0] === "key" && command.includes("Return")) {
    desktop.typed += "\n";
  }
}

function makeNut(events) {
  const state = {
    clicked: false,
    screenshots: 0,
    typed: ""
  };

  return {
    state,
    Button: {
      LEFT: "left",
      MIDDLE: "middle",
      RIGHT: "right"
    },
    Key: {
      Enter: "enter",
      LeftControl: "ctrl",
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
        if (keys.includes("enter")) {
          state.typed += "\n";
        }
      },
      async releaseKey(...keys) {
        events.push(["releaseKey", ...keys]);
      },
      async type(text) {
        events.push(["type", text]);
        state.typed += text;
      }
    },
    mouse: {
      async click(button) {
        events.push(["click", button]);
        state.clicked = true;
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
      state.screenshots += 1;
      await import("node:fs/promises").then(({ writeFile }) => writeFile(path, pngHeader(1440, 900)));
    },
    screen: {
      async capture(filename, format, filePath) {
        events.push(["capture", filename, format, filePath]);
        return { height: 900, width: 1440 };
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

function hasArgPair(args, key, value) {
  const index = args.indexOf(key);
  return index >= 0 && args[index + 1] === value;
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
