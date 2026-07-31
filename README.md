# Automify

**AI computer use for browser, CLI, and desktop workflows in Node.js.**

[![npm version](https://img.shields.io/npm/v/automify.svg)](https://www.npmjs.com/package/automify)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.12.2-brightgreen.svg)](https://nodejs.org/)

`Automify` is a Node.js library for AI computer use and command use across web apps, terminals, native desktops, Docker sandboxes, and QEMU-backed virtual machines.

Computer use surfaces:

| Surface         | Factory                      | Controlled environment                                    |
| --------------- | ---------------------------- | --------------------------------------------------------- |
| Browser         | `automify.browser()`         | Playwright browser with screenshots and actions           |
| Desktop         | `automify.localComputer()`   | Native desktop on macOS, Windows, or Linux X11/Xorg hosts |
| Docker desktop  | `automify.dockerComputer()`  | Linux desktop inside a running Docker container           |
| Virtual desktop | `automify.virtualComputer()` | Linux desktop inside a QEMU VM                            |

Command use surfaces:

| Surface     | Factory                 | What it does                                          |
| ----------- | ----------------------- | ----------------------------------------------------- |
| CLI         | `automify.cli()`        | Terminal automation through model-requested commands  |
| Docker CLI  | `automify.dockerCli()`  | Containerized terminal automation with running Docker |
| Virtual CLI | `automify.virtualCli()` | Terminal automation inside a QEMU VM                  |

OpenAI and Anthropic models are supported, and any other model can be plugged in with a custom provider adapter.

## What You Get

- Computer use for browser, local desktop, Docker desktop, QEMU virtual desktop, and custom computer adapters.
- Command use for local CLI, Docker CLI, and QEMU virtual CLI runs.
- One `.do()` loop: give the model a task, let it request actions, return a structured result.
- Step-by-step task builders for longer workflows that should read like a checklist.
- Structured task input with `data` and structured output with `jsonOutput()`.
- Screen recording for browser and desktop-style computer runs.
- Built-in OpenAI and Anthropic support, plus custom model adapters.
- Practical guardrails: domain allowlists, command policies, screenshot controls, max steps, and hooks.

Full docs live at [aldovincenti.github.io/automify](https://aldovincenti.github.io/automify/). The shorter argument reference is [`docs/argument-reference.md`](docs/argument-reference.md).

## Install

```bash
npm install automify
```

Chromium is installed by the package `postinstall` script. Skip it with:

```bash
AUTOMIFY_SKIP_BROWSER_INSTALL=1 npm install automify
```

Requirements: Node.js `20.12.2+` and a provider config. OpenAI examples use the explicit `gpt-5.6-sol`
model ID so logs, usage, and evaluations identify the selected tier unambiguously. The moving `gpt-5.6` alias currently
routes to Sol; use `gpt-5.6-terra` when cost and latency need a stronger balance, or `gpt-5.6-luna` for high-volume,
cost-sensitive work. Override an example without editing it by setting `OPENAI_MODEL` where that example supports the
environment variable.

GPT-5.6 defaults to `medium` reasoning. Use it as the initial baseline, then compare `low` on representative tasks if
latency or token use matters:

```js
const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5.6-sol"
  },
  reasoning: { effort: "low", summary: "concise" }
});
```

See OpenAI's [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model) before changing model
tier or reasoning effort in production; validate quality, latency, and cost on your own automation traces.

Automify is published as an ES module package, so the examples use modern `import` syntax:

```js
import { initAutomify } from "automify";
```

Use this from an ES module project (`"type": "module"` in `package.json`) or from `.mjs` files. In CommonJS projects, use dynamic `import()` from your `require`-based files instead.

Zod support is optional. Install Zod only if you want to build structured outputs from Zod schemas:

```bash
npm install zod
```

Automify does not require Zod for `jsonOutput()` or any browser, CLI, or desktop runtime.

### Optional Docker Setup

Docker is required only for `automify.dockerCli()` and `automify.dockerComputer()`.

On macOS and Windows, install Docker Desktop from the official Docker website:

- macOS: <https://docs.docker.com/desktop/setup/install/mac-install/>
- Windows: <https://docs.docker.com/desktop/setup/install/windows-install/>

On Ubuntu, install Docker from the Ubuntu repositories:

```bash
sudo apt-get update
sudo apt-get install -y docker.io
```

Use `docker.io`, not the `docker` package. In Ubuntu packages, `docker.io` provides the Docker Engine/runtime and CLI.

Start Docker on Ubuntu and enable it after reboot:

```bash
sudo systemctl enable --now docker
sudo docker run hello-world
```

To run Docker commands without `sudo`, add your user to the `docker` group, then log out and back in:

```bash
sudo usermod -aG docker $USER
```

### Optional QEMU Setup

QEMU is required only for `automify.virtualCli()`, `automify.virtualComputer()`, and `createVirtualDesktopComputer()`.
When no image is configured, Automify downloads the official Debian genericcloud qcow2 image into a local cache, then prepares a reusable Automify-ready Debian qcow2 with the `automify` SSH user already provisioned. Runtime VMs boot from short-lived overlays backed by that prepared image. Pass `image` or `vm.image` only when you want to use your own bootable Linux disk image with SSH access.

```bash
# Ubuntu
sudo apt-get install -y qemu-system qemu-utils

# macOS
brew install qemu

# Windows
# Install QEMU from https://www.qemu.org/download/
```

On Windows, the QEMU installer commonly places binaries in `C:\Program Files\qemu` without making them available in every terminal. Add that directory to your user `PATH` from PowerShell, then open a new terminal and verify both commands work:

```powershell
setx PATH "$env:PATH;C:\Program Files\qemu"
qemu-system-x86_64 --version
qemu-img --version
```

Pre-warm or refresh QEMU image caches:

```bash
# Pre-warm the minimal QEMU CLI cache.
npx automify-qemu-image

# Pre-warm a QEMU CLI cache for examples that need Node.js in the VM.
npx automify-qemu-image --package coreutils --package nodejs

# Use a larger timeout on slow hardware or slow package mirrors.
npx automify-qemu-image --package nodejs --timeout-ms 1200000

# Pre-warm the QEMU desktop cache with Xvfb/openbox/xterm/xdotool/scrot.
npx automify-qemu-image --desktop

# Re-download the Debian base image and rebuild the prepared cache.
npx automify-qemu-image --force-download

# Pre-warm an alternate qcow2 URL into its own cache.
npx automify-qemu-image \
  --image-url https://example.com/path/linux.qcow2 \
  --cache-dir ~/.cache/automify/qemu-custom
```

Use `--image-url` for an alternate apt-based Linux cloud qcow2 that Automify should download, boot, and prepare. Use the same URL and cache directory at runtime with `vm.imageUrl` or `qemuImageUrl` plus `defaultImageCache`. If you pass a local disk with `image` or `vm.image`, Automify uses that qcow2 directly instead of preparing it; the image must already boot, accept SSH, and include the desktop packages required for virtual desktop runs.

## Quick Start

```js
import { initAutomify, jsonOutput } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.6-sol"
  }
});

const browser = await automify.browser({
  // Optional: open a page before the task starts.
  startUrl: "https://aldovincenti.github.io/automify/demo.html"
});

try {
  const run = await browser.do("Add the person from data, then read the Latest saved record JSON block.", {
    // Optional: structured task input.
    data: {
      firstName: "Ada",
      lastName: "Lovelace"
    },
    // Optional: structured result shape.
    output: jsonOutput("person_record", {
      id: "string",
      firstName: "string",
      lastName: "string"
    })
  });

  console.log(run.parsed.id, run.parsed.firstName, run.parsed.lastName);
} catch (error) {
  console.error("Automation failed:", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
```

## Surfaces

### Browser Computer Use

```js
const browser = await automify.browser({
  // Optional: open a page before the task starts.
  startUrl: "https://example.com",
  // Optional: choose the browser viewport.
  viewport: { width: 1280, height: 800 },
  // Optional: restrict browser navigation.
  safety: { domains: ["example.com"] }
});

try {
  const run = await browser.do("Summarize what you see on the page.", {
    // Optional: structured result shape.
    output: jsonOutput("page_summary", { title: "string", summary: "string" })
  });

  console.log(run.parsed.title, run.parsed.summary);
} finally {
  await browser.close();
}
```

Use browser computer use for dashboards, admin panels, forms, and browser-only workflows.

### CLI Command Use

```js
const cli = automify.cli({
  // Optional: constrain command execution.
  command: {
    cwd: process.cwd(),
    allow: ["npm test", "npm run build", "ls", "pwd"]
  }
});

await cli.do("Run the tests and summarize failures");
```

Use Docker CLI when command execution should happen inside an isolated container. Docker must be installed and running before you create the adapter. See [Optional Docker Setup](#optional-docker-setup) if you still need to install Docker:

```js
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initAutomify } from "automify";

const sharedDir = await mkdtemp(join(tmpdir(), "automify-docker-cli-"));
const dataDir = join(sharedDir, "data");
const reportPath = join(dataDir, "report.csv");
const summaryPath = join(dataDir, "summary.json");

await mkdir(dataDir, { recursive: true });
await writeFile(
  reportPath,
  "region,customer,revenue\n" + "North,Ada Corp,1250\n" + "South,Byron Ltd,980\n" + "North,Lovelace Labs,2230\n"
);
await writeFile(summaryPath, "{}\n");

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.6-sol"
  }
});

const cli = automify.dockerCli({
  // Optional: choose resource limits without changing the default image.
  container: { cpus: 1, memory: "1g" },
  // Optional: install apt packages before commands run.
  additionalAptPackages: ["coreutils", "nodejs"],
  // Optional: mount a host folder into the container workspace.
  shared: { hostPath: sharedDir, containerPath: "/workspace" }
});

try {
  await cli.do(
    "Read data/report.csv, use a Node.js script to calculate revenue by region, update data/summary.json with the result, and report the top region"
  );
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  console.log(summary);
  console.log("Shared output file:", summaryPath);
} finally {
  await cli.close();
}
```

Use QEMU virtual CLI when command execution should happen inside a real VM. QEMU must be installed. By default, Automify prepares a minimal Debian cloud image automatically; pass `image` or `vm.image` only to use a custom VM disk:

```js
const cli = automify.virtualCli({
  vm: {
    memory: "2g",
    cpus: 2
  },
  additionalAptPackages: ["coreutils", "nodejs"],
  shared: { hostPath: process.cwd(), containerPath: "/workspace" }
});

try {
  await cli.do("Run 'node --version' and summarize the result");
} finally {
  await cli.close();
}
```

To reuse an alternate qcow2 URL that you pre-warmed with `automify-qemu-image --image-url`, pass the same URL and cache directory:

```js
const cli = automify.virtualCli({
  vm: {
    imageUrl: "https://example.com/path/linux.qcow2"
  },
  defaultImageCache: {
    dir: "/var/cache/automify-qemu-custom"
  }
});
```

### Desktop Computer Use

Local desktop computer use controls the native desktop on the machine running your Node.js process. It supports macOS, Windows, and Linux through the local desktop adapter. On Linux, local desktop support requires X11/Xorg or Xvfb; Wayland sessions are not supported. It needs native desktop dependencies that are not installed by default, and your OS may ask for permission to control the desktop.

**Linux Wayland is not supported for local desktop control.** If `echo $XDG_SESSION_TYPE` prints `wayland`, `localComputer()` can fail during screenshot capture with native X11 errors such as `BadMatch` / `X_GetImage`. Use an Xorg session, run under Xvfb with `forceVirtualDisplay`, or use `dockerComputer()` for an isolated Linux desktop.

Before running `npx automify-install-desktop`, install the native build tools for your OS:

```sh
# Windows: Visual Studio 2022 C++ Build Tools plus CMake on PATH.
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Kitware.CMake --exact --source winget

# macOS: Xcode Command Line Tools plus CMake on PATH.
# If Homebrew is not installed, install it first:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

xcode-select --install
brew install cmake

# Ubuntu Linux.
sudo apt-get install -y git build-essential cmake pkg-config libx11-dev libxtst-dev libpng++-dev
```

On Linux, the documented local desktop path is Ubuntu. Install the full package list before running `npx automify-install-desktop`; the installer checks for command-line build tools but does not verify every native library package. Linux local desktop capture is X11-based: use Xorg/X11, not Wayland. On headless Ubuntu hosts, also install `xvfb` unless you manage `DISPLAY` yourself. On macOS, install Homebrew first if `brew` is not available, then install CMake with `brew install cmake`. On macOS and Windows, `cmake --version` must work in the terminal where you run `npx automify-install-desktop`. On Windows, the VS Code CMake Tools extension is not enough by itself, and Visual Studio 2026 is not currently recognized by the native build chain used by nut.js.

`npx automify-install-desktop` stores the compiled desktop runtime outside `node_modules` in a long-term cache, so normal `npm update` runs do not remove it. If the command is run again and the cached runtime already matches the current platform, CPU architecture, Node ABI, and pinned nut.js/libnut revisions, Automify prints a skip message and exits without rebuilding. Use `npx automify-install-desktop --force` (or `npx automify-install-desktop force`) to rebuild a compatible cache anyway. If a later `npm install` or `npm update` detects that a previously installed desktop runtime no longer matches the current environment, Automify rebuilds it automatically during `postinstall`. Default cache roots are `%LOCALAPPDATA%\automify\desktop-runtime` on Windows, `~/Library/Caches/automify/desktop-runtime` on macOS, and `${XDG_CACHE_HOME:-~/.cache}/automify/desktop-runtime` on Linux. Override with `AUTOMIFY_DESKTOP_RUNTIME_DIR`; disable auto-rebuild with `AUTOMIFY_SKIP_DESKTOP_AUTO_REBUILD=1`.

```js
import { initAutomify } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.6-sol"
  }
});

// Reminder: local desktop support requires `npx automify-install-desktop` once for this project.
const desktop = await automify.localComputer();

try {
  await desktop.do(
    "Open the Calendar app installed on this computer, find the next event, and summarize it. Do not create or edit events."
  );
} finally {
  await desktop.close();
}
```

For isolated Linux desktop computer use, use Docker. `dockerComputer()` can run from a macOS, Windows, or Linux host with Docker installed and running, but the desktop it controls inside the container is Linux. This is the recommended path when the host Linux session uses Wayland, because `localComputer()` does not support Wayland. Docker desktop does not use `automify-install-desktop`; it needs a running Docker daemon and an initial app command. See [Optional Docker Setup](#optional-docker-setup) if Docker is not installed yet:

```js
import { initAutomify } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.6-sol"
  }
});

const desktop = await automify.dockerComputer({
  // Optional: choose resource limits or another image.
  container: { cpus: 2, memory: "2g" },
  // Required: launch an app when the desktop starts.
  desktop: { startupCommand: "xterm" }
});

try {
  await desktop.do("Use the open terminal to run 'uname -a' and summarize the system information shown on screen");
} finally {
  await desktop.close();
}
```

For a real VM-backed Linux desktop, use QEMU. `virtualComputer()` starts a QEMU VM, connects over SSH, and controls an Xvfb desktop inside the guest with `xdotool` and `scrot`. By default, Automify prepares a minimal Debian cloud image automatically; pass `image` or `vm.image` only to use a custom VM disk:

```js
const desktop = await automify.virtualComputer({
  vm: {
    memory: "2g",
    cpus: 2
  },
  desktop: { startupCommand: "xterm" }
});

try {
  await desktop.do("Use the open terminal to run 'uname -a' and summarize the VM system information");
} finally {
  await desktop.close();
}
```

Local desktop computer use takes an exclusive cross-process lock until `close()`. Docker desktop locks are scoped to the container name, and QEMU virtual desktop locks are scoped to the VM name.

### Custom Computer Use

```js
const computer = {
  execute: async (action, context) => remoteDesktop.execute(action, context),
  screenshot: async (context) => remoteDesktop.screenshot(context)
};

await automify.computer({ computer }).do("Use the remote app with the supplied ticket.", {
  // Optional: structured task input.
  data: { ticketId: "SUP-123", priority: "high" }
});
```

Custom computer adapters can expose `environment`, `displayWidth`, and `displayHeight` when they control a fixed remote target. Built-in local, Docker desktop, and QEMU virtual desktop adapters infer or choose those values for you.

## Input And Output

Computer use and command use surfaces share the same `.do()` option shape:

```js
const run = await browser.do("Create the lead from data and return the saved record.", {
  // Optional: structured task input.
  data: { firstName: "Ada", lastName: "Lovelace" },
  // Optional: files the model should inspect directly.
  evaluate: [{ path: "/tmp/reference.png", detail: "high" }],
  // Optional: structured result shape.
  output: jsonOutput("lead", {
    id: "string",
    firstName: "string",
    lastName: "string"
  }),
  // Optional: per-run limits.
  limits: { steps: 20 },
  // Optional: save run screenshots.
  screenshots: { final: "/tmp/automify-final.png" }
});
```

For longer workflows, build the task as ordered steps and run it at the end. This is useful when the task has
distinct phases, such as navigate, wait, create, verify, and extract:

```js
const run = await browser
  .addStep("Open the contacts page.")
  .addWait("the contacts table is visible")
  .addStep("Create the lead from data.")
  .addExtract("Return the saved record JSON.", {
    key: "lead",
    shape: { id: "string", firstName: "string", lastName: "string" }
  })
  .addData({ firstName: "Ada", lastName: "Lovelace" })
  .run();

console.log(run.parsed.lead.id);
```

You can also start from `browser.task()` when you want to keep a reusable builder variable:

```js
const task = browser
  .task({ limits: { steps: 30 } })
  .addStep("Open the billing page.")
  .addWait("the invoice list has finished loading")
  .addObserve("Find the newest unpaid invoice.")
  .addAssert("Confirm the customer name matches the data.")
  .addExtract("Return the invoice id and total.", {
    key: "invoice",
    shape: { id: "string", total: "number" }
  })
  .addExtract("Return audit metadata.", {
    key: "audit",
    shape: { requestId: "string" }
  })
  .withData({ customerName: "Ada Lovelace" });

const run = await task.run();
```

Builder steps are converted into one ordered `.do()` instruction, so hooks, screenshots, output parsing, safety
options, and limits behave the same as a normal run. `addStep()` is the general-purpose method; `addAct()` is an alias
for action-oriented steps. `addWait("condition")` waits for a visible condition; `addWait(500)` remains supported and
maps to `addPause(500)`. `addObserve()`, `addExtract()`, and `addAssert()` add readable intent for common phases. When
`addExtract()` gets `{ key, shape }`, Automify builds the structured output for you, and multiple extracts are returned
under `run.parsed[key]`. Short aliases without `add` also work: `step()`, `act()`, `wait()`, `waitFor()`, `pause()`,
`observe()`, `extract()`, and `assert()`.

Use `task({ mode: "sequential" })` when each step should be its own model run. Sequential mode preserves the same
builder API, but executes every non-pause step separately, keeps browser or desktop state between steps, and returns a
`taskSteps` audit trail in addition to the aggregated action `steps`. `addPause(ms)` is deterministic in this mode and
does not call the model. `addAssert()` asks the model for a structured pass/fail check and fails the task when the
assertion is not true.

```js
const run = await browser
  .task({ mode: "sequential" })
  .addStep("Fill the first name field from data.")
  .addStep("Fill the last name field from data.")
  .addStep("Submit the form.")
  .addExtract("Return the saved record JSON.", {
    key: "record",
    shape: { id: "string", firstName: "string", lastName: "string" }
  })
  .addData({ firstName: "Dorothy", lastName: "Vaughan" })
  .run({ recording: "/tmp/automify-sequential.mp4" });

console.log(run.taskSteps.length);
console.log(run.parsed.record.id);
console.log(run.recording.path);
```

In sequential mode, a run-level `output` applies only to the final non-pause step. Extract outputs still belong on
`addExtract()` steps; if you define multiple extracts, give each one a `key`. Browser and desktop recordings cover the
whole sequential task. CLI tasks can run sequentially, but CLI adapters do not record the screen.

- `data` is structured JSON for the task.
- `evaluate` sends images or text files directly to the model.
- `shared` and `sharedFiles` expose files inside Docker CLI, Docker desktop, QEMU virtual CLI, or QEMU virtual desktop runs.
- `jsonOutput()` requests structured JSON and makes parsed output available as `run.parsed`.
- `limits.steps` controls the maximum model-action turns before `MaxStepsExceededError`. The default is `100`.

Visual adapters can record a run by polling screenshots and encoding them with `ffmpeg`:

```js
const run = await browser.do("Run the checkout smoke test.", {
  recording: "/tmp/automify-checkout.mp4"
});

console.log(run.recording.path);
```

Use `recording` or `screenRecording`. Pass a string for the output path, `true` to write a temp MP4, or an object when
you need control over capture rate and encoding:

```js
const run = await browser.do("Run the checkout smoke test.", {
  screenRecording: {
    path: "/tmp/automify-checkout.mp4",
    fps: 6,
    keepFrames: false
  }
});

console.log(run.recording.frames);
```

Recording works for browser and computer-use adapters. CLI adapters do not produce screen recordings. The host process
needs `ffmpeg` on PATH unless you pass `screenRecording.ffmpegCommand` or a custom `screenRecording.execFile`.

Set max steps on an adapter when most runs need the same limit:

```js
const browser = await automify.browser({
  startUrl: "https://example.com",
  limits: { steps: 250 }
});
```

Override it for one `.do()` call when a task needs a different limit:

```js
await browser.do("Quick smoke test", {
  limits: { steps: 25 }
});
```

The older flat option also works: `maxSteps: 250` is equivalent to `limits: { steps: 250 }`. If both are provided,
`maxSteps` wins.

For arrays of objects, the most ergonomic shape is usually an object with a named array property:

```js
const run = await browser.do("Extract the products.", {
  output: jsonOutput("product_list", {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sku: { type: "string" },
          title: { type: "string" },
          price: { type: "number" }
        },
        required: ["sku", "title", "price"],
        additionalProperties: false
      }
    }
  })
});

console.log(run.parsed.products);
```

If you need `run.parsed` itself to be an array, pass the lower-level `json_schema` output format directly:

```js
const run = await browser.do("Extract the products.", {
  output: {
    type: "json_schema",
    name: "products",
    strict: true,
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sku: { type: "string" },
          title: { type: "string" },
          price: { type: "number" }
        },
        required: ["sku", "title", "price"],
        additionalProperties: false
      }
    }
  }
});

console.log(run.parsed[0].sku);
```

### Optional Zod Output

If your app already uses Zod 4, you can use the optional Zod adapter instead of writing compact shapes or JSON Schema by hand. Install `zod` in your app and import from the dedicated `automify/zod` subpath:

```js
import { z } from "zod";
import { zodOutput } from "automify/zod";

const Lead = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string()
});

const run = await browser.do("Create the lead and return it.", {
  output: zodOutput("lead", Lead)
});

console.log(run.parsed.id);
```

Zod works well for array outputs too:

```js
const ProductList = z.object({
  products: z.array(
    z.object({
      sku: z.string(),
      title: z.string(),
      price: z.number()
    })
  )
});

const run = await browser.do("Extract the products.", {
  output: zodOutput("product_list", ProductList)
});

console.log(run.parsed.products);
```

`zodOutput()` is not part of the main `automify` import on purpose. Zod is an optional peer dependency, so projects that only use `jsonOutput()` do not need to install it.

At runtime, `zodOutput()` does two things:

- It converts the Zod schema to JSON Schema with Zod 4's `z.toJSONSchema()` and sends that schema to the model.
- It validates the parsed model response with the original schema's `schema.parse()` before assigning `run.parsed`.

Pass `{ parse: false }` if you want Automify to request the Zod-derived JSON Schema but skip automatic parsing and Zod validation of the final response.

## Safety

Before running computer use against real accounts or user data:

| Area    | Recommendation                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| Scope   | Use dedicated accounts, narrow browser allowlists, command policies, and isolated desktops or containers.     |
| Data    | Pass task input through `data`; request application output with `jsonOutput()` instead of parsing prose.      |
| Safety  | Add human approval for sensitive CLI commands, browser actions, or externally visible operations.             |
| Privacy | Redact screenshots before model upload when screens can contain secrets or regulated data.                    |
| Audit   | Use `hooks`, `screenshots.actions`, `recording`, `logFile`, and `trace: true` for workflows that need review. |

## Providers

```js
const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.6-sol"
  }
});
```

Anthropic and custom model gateways are supported too:

```js
const automify = initAutomify({
  provider: {
    type: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-sonnet-4-20250514",
    // Optional: provider-specific settings.
    maxTokens: 4096,
    betas: ["computer-use-2025-01-24"]
  }
});
```

```js
const automify = initAutomify({
  provider: {
    type: "custom",
    model: "my-model",
    // Optional: adapt a custom model gateway.
    adapter: {
      async respond(payload, context) {
        return { id: "custom_response", output: [] };
      }
    }
  }
});
```

Use the adapter toolkit when a custom provider needs to emit computer use actions. See `examples/custom-model-adapter.js` and `examples/claude-model-adapter.js`.

## Examples

- `examples/browser-basic.js`
- `examples/browser-with-safety.js`
- `examples/cli-basic.js`
- `examples/cli-docker.js`
- `examples/cli-qemu.js`
- `examples/desktop-local.js`
- `examples/desktop-docker.js`
- `examples/desktop-qemu.js`
- `examples/custom-computer.js`
- `examples/custom-model-adapter.js`

## Tests

```bash
npm test
npm run test:e2e
OPENAI_API_KEY=... npm run test:live
npm run test:live:qemu
npm run test:live:qemu:desktop
```

`npm run test:live:qemu` runs only the real QEMU Debian boot smoke test, without OpenAI. `npm run test:live:qemu:desktop` runs the real QEMU desktop smoke test with the default Debian image. Set `AUTOMIFY_QEMU_IMAGE=/path/to/linux.qcow2` only when you want the desktop smoke test or the QEMU live tests to use a custom image. The equivalent direct flags are `RUN_QEMU_DEBIAN_E2E=1 npm run test:e2e` and `RUN_QEMU_DESKTOP_E2E=1 npm run test:e2e`.

`npm run test:live` runs `test/e2e/live-openai.e2e.test.js` with `RUN_OPENAI_E2E=1`. By default, it runs the live OpenAI CLI and Docker CLI checks and skips the browser, Docker desktop, and QEMU checks. Set `RUN_OPENAI_BROWSER_E2E=1` to include the live browser demo tests, including task-builder and recording coverage.

Run every live test:

```bash
OPENAI_API_KEY=... \
RUN_OPENAI_BROWSER_E2E=1 \
RUN_OPENAI_DOCKER_DESKTOP_E2E=1 \
RUN_OPENAI_QEMU_CLI_E2E=1 \
RUN_OPENAI_QEMU_DESKTOP_E2E=1 \
npm run test:live
```

The equivalent direct command is:

```bash
OPENAI_API_KEY=... \
RUN_OPENAI_E2E=1 \
RUN_OPENAI_BROWSER_E2E=1 \
RUN_OPENAI_DOCKER_DESKTOP_E2E=1 \
RUN_OPENAI_QEMU_CLI_E2E=1 \
RUN_OPENAI_QEMU_DESKTOP_E2E=1 \
node --test test/e2e/live-openai.e2e.test.js
```

Use `AUTOMIFY_QEMU_DEFAULT_IMAGE_URL` to point the default Debian download at a mirror, and `AUTOMIFY_QEMU_IMAGE_CACHE_DIR` to choose the cache directory. By default, Automify caches the downloaded Debian base image and prepared Automify-ready Debian images on the user's computer. CLI cache variants bake the requested `packages` and `additionalAptPackages`; the desktop cache is a separate variant that bakes Xvfb/openbox/xterm/xdotool/scrot so warm desktop boots do not reinstall apt packages. Configure image caching with `defaultImageCache`, for example `defaultImageCache: { dir: "/var/cache/automify-qemu", forcePrepare: true }`. Run `npx automify-qemu-image` to pre-warm the minimal QEMU CLI cache, or add flags such as `--package coreutils --package nodejs` to pre-warm a package-specific CLI cache. The default preparation timeout is generous, but `--timeout-ms 1200000` can help on slow hardware or package mirrors. Run `npx automify-qemu-image --desktop` to pre-warm the QEMU desktop cache. Run `npx automify-qemu-image --image-url https://example.com/path/linux.qcow2 --cache-dir /var/cache/automify-qemu-custom` to pre-warm an alternate cloud qcow2 cache, then use the same URL and cache directory at runtime with `vm.imageUrl` or `qemuImageUrl` plus `defaultImageCache`. Run `npx automify-qemu-image --force-download` to replace the cached base image and rebuild the prepared image. Local disks passed with `image` or `vm.image` are not prepared by the cache command; they must already be bootable with SSH access. On ARM hosts Automify auto-detects common QEMU UEFI firmware paths; set `AUTOMIFY_QEMU_FIRMWARE` if your QEMU install keeps the firmware elsewhere.

## License

MIT

## Disclaimer

Automify is distributed "as is", without warranty of any kind. Automation can control browsers, shells, desktops, files, and external services; you are responsible for how you configure and run it, and for any events associated with that use. To the maximum extent permitted by law, the author is not liable for losses, damages, data loss, service disruption, or other consequences arising from use of the software.

Created by [Aldo Vincenti](https://aldovincenti.com).
