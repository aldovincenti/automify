# Automify

**AI computer use for browser, CLI, and desktop workflows in Node.js.**

[![npm version](https://img.shields.io/npm/v/automify.svg)](https://www.npmjs.com/package/automify)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.18-brightgreen.svg)](https://nodejs.org/)

`Automify` is a Node.js library for AI computer use and command use across web apps, terminals, native desktops, Docker CLI sandboxes, and Docker-backed Linux desktops.

Computer use surfaces:

| Surface        | Factory                     | What it does                                               |
| -------------- | --------------------------- | ---------------------------------------------------------- |
| Browser        | `automify.browser()`        | Playwright browser automation with screenshots and actions |
| Desktop        | `automify.localComputer()`  | Native desktop computer use on the current machine         |
| Docker desktop | `automify.dockerComputer()` | Containerized Linux desktop automation with screenshots    |

Command use surfaces:

| Surface    | Factory                | What it does                                         |
| ---------- | ---------------------- | ---------------------------------------------------- |
| CLI        | `automify.cli()`       | Terminal automation through model-requested commands |
| Docker CLI | `automify.dockerCli()` | Containerized terminal automation with shared files  |

OpenAI and Anthropic models are supported, and any other model can be plugged in with a custom provider adapter.

## What You Get

- Computer use for browser, local desktop, Docker desktop, and custom computer adapters.
- Command use for local CLI and Docker CLI runs.
- One `.do()` loop: give the model a task, let it request actions, return a structured result.
- Structured task input with `data` and structured output with `jsonOutput()`.
- Built-in OpenAI and Anthropic support, plus custom model adapters.
- Practical guardrails: domain allowlists, command policies, screenshot controls, max steps, and hooks.

Full docs live in [`docs/documentation.html`](docs/documentation.html). The shorter argument reference is [`docs/argument-reference.md`](docs/argument-reference.md).

## Install

```bash
npm install automify
```

Chromium is installed by the package `postinstall` script. Skip it with:

```bash
AUTOMIFY_SKIP_BROWSER_INSTALL=1 npm install automify
```

Requirements: Node.js `18.18+` and a provider config. OpenAI examples use `gpt-5.5`.

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
  const run = await browser.do("Extract the support email.", {
    // Optional: structured result shape.
    output: jsonOutput("support_contact", { email: "string" })
  });

  console.log(run.parsed.email);
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

Use Docker CLI when command execution should happen inside an isolated container:

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

Local desktop computer use is optional because OS control needs permissions:

```bash
npm run install:desktop
```

```js
import { initAutomify } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

const desktop = await automify.localComputer();

try {
  await desktop.do(
    "Open the Calendar app installed on this computer, find the next event after today, and summarize it. Do not create or edit events."
  );
} finally {
  await desktop.close();
}
```

For isolated Linux desktop computer use, use Docker:

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

## License

MIT
