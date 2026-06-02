# Automify

**AI computer use for browser, CLI, and desktop workflows in Node.js.**

[![npm version](https://img.shields.io/npm/v/automify.svg)](https://www.npmjs.com/package/automify)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.12.2-brightgreen.svg)](https://nodejs.org/)

`Automify` is a Node.js library for AI computer use and command use across web apps, terminals, native desktops, Docker CLI sandboxes, and Docker-backed Linux desktops.

Computer use surfaces:

| Surface        | Factory                     | Controlled environment                                      |
| -------------- | --------------------------- | ----------------------------------------------------------- |
| Browser        | `automify.browser()`        | Playwright browser with screenshots and actions             |
| Desktop        | `automify.localComputer()`  | Native desktop on the current macOS, Windows, or Linux host |
| Docker desktop | `automify.dockerComputer()` | Linux desktop inside a running Docker container             |

Command use surfaces:

| Surface    | Factory                | What it does                                          |
| ---------- | ---------------------- | ----------------------------------------------------- |
| CLI        | `automify.cli()`       | Terminal automation through model-requested commands  |
| Docker CLI | `automify.dockerCli()` | Containerized terminal automation with running Docker |

OpenAI and Anthropic models are supported, and any other model can be plugged in with a custom provider adapter.

## What You Get

- Computer use for browser, local desktop, Docker desktop, and custom computer adapters.
- Command use for local CLI and Docker CLI runs.
- One `.do()` loop: give the model a task, let it request actions, return a structured result.
- Structured task input with `data` and structured output with `jsonOutput()`.
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

Requirements: Node.js `20.12.2+` and a provider config. OpenAI examples use `gpt-5.5`.

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

## Quick Start

```js
import { initAutomify, jsonOutput } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
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

  console.log(run.ok, run.parsed.id, run.parsed.firstName, run.parsed.lastName);
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

Use Docker CLI when command execution should happen inside an isolated container. Docker must be installed and running before you create the adapter:

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
    model: "gpt-5.5"
  }
});

const cli = automify.dockerCli({
  // Optional: choose resource limits without changing the default image.
  container: { cpus: 1, memory: "1g" },
  // Optional: install Debian packages before commands run.
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

### Desktop Computer Use

Local desktop computer use controls the native desktop on the machine running your Node.js process. It supports macOS, Windows, and Linux through the local desktop adapter. It needs native desktop dependencies that are not installed by default, and your OS may ask for permission to control the desktop.

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

# Debian/Ubuntu Linux.
sudo apt-get install -y git build-essential cmake pkg-config libx11-dev libxtst-dev libpng++-dev

# Fedora Linux.
sudo dnf install -y gcc-c++ make cmake libXtst-devel libpng-devel

# Arch Linux.
sudo pacman -S --needed base-devel cmake libxtst libpng
```

On Linux, install the full package list before running `npx automify-install-desktop`; the installer checks for command-line build tools but does not verify every native library package. On headless Linux hosts, also install `xvfb` unless you manage `DISPLAY` yourself. On macOS, install Homebrew first if `brew` is not available, then install CMake with `brew install cmake`. On macOS and Windows, `cmake --version` must work in the terminal where you run `npx automify-install-desktop`. On Windows, the VS Code CMake Tools extension is not enough by itself, and Visual Studio 2026 is not currently recognized by the native build chain used by nut.js.

`npx automify-install-desktop` stores the compiled desktop runtime outside `node_modules` in a long-term cache, so normal `npm update` runs do not remove it. If a later `npm install` or `npm update` detects that a previously installed desktop runtime no longer matches the current platform, CPU architecture, Node ABI, or pinned nut.js/libnut revisions, Automify rebuilds it automatically during `postinstall`. Default cache roots are `%LOCALAPPDATA%\automify\desktop-runtime` on Windows, `~/Library/Caches/automify/desktop-runtime` on macOS, and `${XDG_CACHE_HOME:-~/.cache}/automify/desktop-runtime` on Linux. Override with `AUTOMIFY_DESKTOP_RUNTIME_DIR`; disable auto-rebuild with `AUTOMIFY_SKIP_DESKTOP_AUTO_REBUILD=1`.

```js
import { initAutomify } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

// Reminder: local desktop support requires `npx automify-install-desktop` once for this project.
const desktop = await automify.localComputer();

try {
  await desktop.do(
    "Open the Calendar app installed on this computer, find the next event after today, and summarize it. Do not create or edit events."
  );
} finally {
  await desktop.close();
}
```

For isolated Linux desktop computer use, use Docker. `dockerComputer()` can run from a macOS, Windows, or Linux host with Docker installed and running, but the desktop it controls inside the container is Linux. Docker desktop does not use `automify-install-desktop`; it needs a running Docker daemon and an initial app command:

```js
import { initAutomify } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
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

Local desktop computer use takes an exclusive cross-process lock until `close()`. Docker desktop locks are scoped to the container name, so different containers can run in parallel.

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

Custom computer adapters can expose `environment`, `displayWidth`, and `displayHeight` when they control a fixed remote target. Built-in local and Docker desktop adapters infer or choose those values for you.

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

- `data` is structured JSON for the task.
- `evaluate` sends images or text files directly to the model.
- `shared` and `sharedFiles` expose files inside Docker CLI or Docker desktop runs.
- `jsonOutput()` requests structured JSON and makes parsed output available as `run.parsed`.

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

| Area    | Recommendation                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------- |
| Scope   | Use dedicated accounts, narrow browser allowlists, command policies, and isolated desktops or containers. |
| Data    | Pass task input through `data`; request application output with `jsonOutput()` instead of parsing prose.  |
| Safety  | Add human approval for sensitive CLI commands, browser actions, or externally visible operations.         |
| Privacy | Redact screenshots before model upload when screens can contain secrets or regulated data.                |
| Audit   | Use `hooks`, `screenshots.actions`, `logFile`, and `trace: true` for workflows that need review.          |

## Providers

```js
const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
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
- `examples/desktop-local.js`
- `examples/desktop-docker.js`
- `examples/custom-computer.js`
- `examples/custom-model-adapter.js`

## Tests

```bash
npm test
npm run test:e2e
OPENAI_API_KEY=... npm run test:live
```

`npm run test:live` runs `test/e2e/live-openai.e2e.test.js` with `RUN_OPENAI_E2E=1`. By default, it runs the live OpenAI CLI and Docker CLI checks and skips the browser and Docker desktop checks.

Run every live test:

```bash
OPENAI_API_KEY=... \
RUN_OPENAI_BROWSER_E2E=1 \
RUN_OPENAI_VIRTUAL_DESKTOP_E2E=1 \
npm run test:live
```

The equivalent direct command is:

```bash
OPENAI_API_KEY=... \
RUN_OPENAI_E2E=1 \
RUN_OPENAI_BROWSER_E2E=1 \
RUN_OPENAI_VIRTUAL_DESKTOP_E2E=1 \
node --test test/e2e/live-openai.e2e.test.js
```

## License

MIT
