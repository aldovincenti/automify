import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AutomifyError } from "./errors.js";
import { acquireAdapterLock } from "./adapter-locks.js";
import { applyDockerDesktopPreset } from "./presets.js";
import { assertKnownOptions, debugLog, normalizeLogFile, writeDebugLogFile } from "./runtime.js";
import { prepareVirtualSharedFolder } from "./virtual-shared-folder.js";

const execFileAsync = promisify(execFile);

const DEFAULT_IMAGE = "debian:bookworm-slim";
const DEFAULT_ENVIRONMENT = "linux";
const DEFAULT_DISPLAY = ":99";
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const DEFAULT_DEPTH = 24;
const DEFAULT_DESKTOP_PACKAGES = [
  "xvfb",
  "openbox",
  "xterm",
  "x11-utils",
  "xdotool",
  "imagemagick",
  "scrot",
  "ca-certificates"
];
const DEFAULT_INSTRUCTIONS = [
  "You are controlling an isolated Linux desktop running in a virtual display.",
  "Orient from the screenshot first: identify the active app, visible window, focused field, current page, and the specific target required by the task before acting.",
  "Use deterministic entry points. For a website or web app, use the browser address bar only when a browser is clearly focused; otherwise use a visible app icon, terminal command, launcher/search mechanism, or provided startup app. For app content, use visible search, filters, or navigation controls.",
  "Do not open or use Alt+Tab or other cyclic app/window switchers unless the task explicitly asks to switch to the previous app. Cyclic switching is unreliable because the window order is unknown.",
  "Do not click as a probe. Click only when the screenshot shows a specific visible target and the purpose of that click is clear from the task or current UI. Prefer named controls, fields, menu items, visible app icons, terminal prompts, and address/search fields over unlabeled areas.",
  "Treat the environment as ephemeral: do not depend on host desktop state, personal accounts, or files outside the shared workspace unless the task provides them.",
  "If the target is not visible, choose a deterministic recovery path: direct URL, terminal command, launcher/search, in-app search, visible navigation, or a screenshot/wait when loading is visible. Do not repeat nearly identical clicks after no visible change.",
  "After any action that launches an app, navigates, submits input, changes windows, or might trigger loading, use the next screenshot to decide the next step. Stop when the requested result is known; do not keep interacting to confirm unnecessarily."
].join("\n");
const VIRTUAL_DESKTOP_OPTION_KEYS = new Set([
  "preset",
  "container",
  "dockerCommand",
  "image",
  "containerName",
  "existingContainer",
  "keepContainer",
  "start",
  "display",
  "viewport",
  "displayWidth",
  "displayHeight",
  "displayDepth",
  "environment",
  "instructions",
  "desktop",
  "startupCommand",
  "windowManagerCommand",
  "autoRemove",
  "sandbox",
  "installDependencies",
  "desktopPackages",
  "additionalAptPackages",
  "network",
  "cpus",
  "memory",
  "memorySwap",
  "cpuShares",
  "cpusetCpus",
  "packageManager",
  "readOnly",
  "pidsLimit",
  "shmSize",
  "tmpfsTmp",
  "tmpfsRun",
  "volumes",
  "env",
  "shared",
  "sharedFolder",
  "sharedFiles",
  "files",
  "waitMs",
  "startupTimeoutMs",
  "dockerTimeoutMs",
  "screenshotMaxBuffer",
  "logsMaxBuffer",
  "screenshotSettleMs",
  "execFile",
  "silent",
  "debug",
  "logFile",
  "onUnknownAction"
]);
export const DOCKER_DESKTOP_COMPUTER_OPTION_KEYS = VIRTUAL_DESKTOP_OPTION_KEYS;
const VIRTUAL_DESKTOP_CONTAINER_KEYS = new Set([
  "docker",
  "dockerCommand",
  "image",
  "name",
  "existing",
  "keep",
  "autoRemove",
  "sandbox",
  "readOnly",
  "network",
  "cpus",
  "memory",
  "memorySwap",
  "cpuShares",
  "cpusetCpus",
  "pidsLimit",
  "shmSize",
  "tmpfsTmp",
  "tmpfsRun",
  "volumes",
  "env",
  "timeoutMs",
  "cwd",
  "workdir",
  "packages",
  "additionalAptPackages",
  "installDependencies"
]);
const VIRTUAL_DESKTOP_DESKTOP_KEYS = new Set([
  "startupCommand",
  "windowManagerCommand",
  "packages",
  "additionalAptPackages",
  "installDependencies",
  "packageManager"
]);

export async function createDockerDesktopComputer(options = {}) {
  options = normalizeVirtualDesktopOptions(options);
  const releaseLock = await acquireDockerDesktopLock(options);
  debugVirtualDesktop(options, "create", {
    image: options.image ?? DEFAULT_IMAGE,
    containerName: options.containerName ?? null,
    start: options.start !== false
  });
  try {
    const session = new DockerDesktopSession(options);
    await session.prepareSharedFolder();
    if (options.start !== false) {
      await session.start();
    }

    const computer = {
      displayWidth: session.width,
      displayHeight: session.height,
      environment: options.environment ?? DEFAULT_ENVIRONMENT,
      instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,

      async execute(action) {
        await session.execute(action);
      },

      async screenshot(context) {
        return session.screenshot(context);
      },

      async close() {
        try {
          await session.close();
        } finally {
          await releaseLock?.();
        }
      },

      session
    };
    computer.sharedFolder = session.sharedFolder?.data;
    return computer;
  } catch (error) {
    await releaseLock?.();
    throw error;
  }
}

export class DockerDesktopSession {
  constructor(options = {}) {
    options = normalizeVirtualDesktopOptions(options);
    this.options = options;
    this.docker = options.dockerCommand ?? "docker";
    this.execFile = options.execFile ?? execFileAsync;
    this.image = options.image ?? DEFAULT_IMAGE;
    this.name = options.containerName ?? `automify-desktop-${randomUUID()}`;
    this.display = normalizeDisplay(options.display ?? DEFAULT_DISPLAY);
    this.width = positiveInteger(options.displayWidth) ?? DEFAULT_WIDTH;
    this.height = positiveInteger(options.displayHeight) ?? DEFAULT_HEIGHT;
    this.depth = positiveInteger(options.displayDepth) ?? DEFAULT_DEPTH;
    this.installDependencies = options.installDependencies ?? isBaseLinuxImage(this.image);
    this.sharedFolder = null;
    this.started = false;
    this.created = false;
  }

  async prepareSharedFolder() {
    if (this.sharedFolder) return this.sharedFolder;
    this.sharedFolder = await prepareVirtualSharedFolder(this.options, {
      prefix: "automify-docker-desktop-"
    });
    return this.sharedFolder;
  }

  async start() {
    if (this.started) return;
    await this.prepareSharedFolder();
    if (this.options.existingContainer) {
      debugVirtualDesktop(this.options, "use_existing_container", { containerName: this.name });
      this.started = true;
      return;
    }

    debugVirtualDesktop(this.options, "container_start", {
      containerName: this.name,
      image: this.image,
      display: this.display,
      width: this.width,
      height: this.height,
      installDependencies: this.installDependencies
    });
    const args = [
      "run",
      "-d",
      "--name",
      this.name,
      "--network",
      dockerNetwork(this.options.network),
      "--pids-limit",
      String(positiveInteger(this.options.pidsLimit) ?? 512),
      "--shm-size",
      String(this.options.shmSize ?? "1g"),
      "--tmpfs",
      String(this.options.tmpfsTmp ?? "/tmp:exec,nosuid,nodev,size=512m"),
      "--tmpfs",
      String(this.options.tmpfsRun ?? "/run:nosuid,nodev,size=64m"),
      "-e",
      `DISPLAY=${this.display}`
    ];
    appendDockerResourceArgs(args, this.options);

    if (this.options.autoRemove === true) {
      args.splice(2, 0, "--rm");
    }
    if (this.options.sandbox !== false && !this.installDependencies) {
      args.push("--cap-drop", "ALL", "--security-opt", "no-new-privileges");
    }
    if (this.options.readOnly !== false && !this.installDependencies) {
      args.push("--read-only");
    }
    for (const volume of this.options.volumes ?? []) {
      args.push("-v", String(volume));
    }
    if (this.sharedFolder) {
      args.push("-v", this.sharedFolder.volume);
    }
    for (const env of this.options.env ?? []) {
      args.push("-e", String(env));
    }

    args.push(this.image, "sh", "-lc", this.startupScript());
    await this.runDocker(args, "start Docker desktop container");
    debugVirtualDesktop(this.options, "container_created", { containerName: this.name });
    this.created = true;
    this.started = true;
    try {
      await this.waitForReady();
      debugVirtualDesktop(this.options, "desktop_ready", { containerName: this.name, display: this.display });
    } catch (error) {
      const diagnostics = await this.startupDiagnostics();
      await this.close();
      throw new AutomifyError(
        [
          "Virtual Linux desktop did not become ready before startupTimeoutMs.",
          diagnostics ? `Docker diagnostics:\n${diagnostics}` : null
        ]
          .filter(Boolean)
          .join("\n"),
        { cause: error }
      );
    }
  }

  startupScript() {
    const windowManager = this.options.windowManagerCommand ?? "openbox";
    const app = this.options.startupCommand;
    const xvfb = [
      "Xvfb",
      shellQuote(this.display),
      "-screen",
      "0",
      shellQuote(`${this.width}x${this.height}x${this.depth}`),
      "-nolisten",
      "tcp"
    ].join(" ");
    const parts = [
      this.dependencyInstallScript(),
      `${xvfb} &`,
      "XVFB_PID=$!",
      "sleep 0.2",
      `${windowManager} >/tmp/automify-window-manager.log 2>&1 &`
    ];
    parts.push(`${app} >/tmp/automify-startup.log 2>&1 &`);
    parts.push("wait $XVFB_PID");
    return parts.join("\n");
  }

  dependencyInstallScript() {
    if (!this.installDependencies) return ":";

    const packages = uniquePackages([
      ...(this.options.desktopPackages ?? DEFAULT_DESKTOP_PACKAGES),
      ...(this.options.additionalAptPackages ?? [])
    ])
      .map((pkg) => shellQuote(pkg))
      .join(" ");
    const packageManager = this.options.packageManager ?? "apt";

    if (packageManager !== "apt") {
      return String(packageManager);
    }

    return [
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update",
      packages ? `apt-get install -y --no-install-recommends ${packages}` : ":",
      "rm -rf /var/lib/apt/lists/*"
    ].join("\n");
  }

  async waitForReady() {
    const timeoutMs = positiveInteger(this.options.startupTimeoutMs) ?? (this.installDependencies ? 120_000 : 10_000);
    const startedAt = Date.now();
    let lastError;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.exec(["sh", "-lc", "xdpyinfo >/dev/null 2>&1"]);
        return;
      } catch (error) {
        lastError = error;
        await sleep(150);
      }
    }

    throw lastError ?? new AutomifyError("Virtual Linux desktop readiness check timed out.");
  }

  async execute(action) {
    await this.start();
    if (!action || typeof action !== "object") {
      throw new AutomifyError("Docker desktop action must be an object.");
    }
    debugVirtualDesktop(this.options, "action", { action });

    switch (action.type) {
      case "click":
        await this.exec(["xdotool", "mousemove", x(action.x), y(action.y), "click", button(action.button)]);
        break;
      case "double_click":
        await this.exec([
          "xdotool",
          "mousemove",
          x(action.x),
          y(action.y),
          "click",
          "--repeat",
          "2",
          button(action.button)
        ]);
        break;
      case "scroll":
        await this.scroll(action);
        break;
      case "keypress":
        await this.exec(["xdotool", "key", ...keys(action.keys ?? [action.key])]);
        break;
      case "type":
        await this.exec(["xdotool", "type", "--clearmodifiers", "--", String(action.text ?? "")]);
        break;
      case "wait":
        await sleep(Math.max(0, Number(action.ms ?? action.duration_ms ?? this.options.waitMs ?? 1000) || 0));
        break;
      case "screenshot":
        break;
      case "move":
        await this.exec(["xdotool", "mousemove", x(action.x), y(action.y)]);
        break;
      case "drag":
        await this.drag(action);
        break;
      default:
        if (typeof this.options.onUnknownAction === "function") {
          await this.options.onUnknownAction(action);
          break;
        }
        throw new AutomifyError(`Unsupported Docker desktop action: ${action.type}`);
    }
  }

  async scroll(action) {
    const scrollY = Number(action.scroll_y ?? action.delta_y ?? action.deltaY ?? 0);
    const scrollX = Number(action.scroll_x ?? action.delta_x ?? action.deltaX ?? 0);
    const amount = Math.max(1, Math.ceil(Math.max(Math.abs(scrollY), Math.abs(scrollX)) / 120));
    const scrollButton = Math.abs(scrollX) > Math.abs(scrollY) ? (scrollX > 0 ? "7" : "6") : scrollY > 0 ? "5" : "4";
    await this.exec([
      "xdotool",
      "mousemove",
      x(action.x),
      y(action.y),
      "click",
      "--repeat",
      String(amount),
      scrollButton
    ]);
  }

  async drag(action) {
    const path = action.path?.length ? action.path : [action, action];
    const start = path[0];
    const end = path.at(-1);
    await this.exec(["xdotool", "mousemove", x(start.x), y(start.y), "mousedown", "1"]);
    for (const point of path.slice(1)) {
      await this.exec(["xdotool", "mousemove", x(point.x), y(point.y)]);
    }
    await this.exec(["xdotool", "mousemove", x(end.x), y(end.y), "mouseup", "1"]);
  }

  async screenshot(context) {
    await this.start();
    const startedAt = Date.now();
    if (context?.initial || context?.final) {
      await sleep(this.options.screenshotSettleMs ?? 300);
    }
    const { stdout } = await this.execFile(
      this.docker,
      [
        "exec",
        "-e",
        `DISPLAY=${this.display}`,
        this.name,
        "sh",
        "-lc",
        "scrot -o - 2>/dev/null || import -window root -screen png:-"
      ],
      {
        encoding: "buffer",
        maxBuffer: this.options.screenshotMaxBuffer ?? 20 * 1024 * 1024
      }
    );
    debugVirtualDesktop(this.options, "screenshot", {
      phase: context?.final ? "final" : context?.initial ? "initial" : "step",
      bytes: stdout?.byteLength,
      durationMs: Date.now() - startedAt
    });
    return stdout;
  }

  async exec(args, options = {}) {
    return this.execFile(this.docker, ["exec", "-e", `DISPLAY=${this.display}`, this.name, ...args], options);
  }

  async runDocker(args, label) {
    debugVirtualDesktop(this.options, "docker", { label, args: summarizeDockerArgs(args) });
    try {
      return await this.execFile(this.docker, args, {
        timeout: this.options.dockerTimeoutMs ?? 30_000
      });
    } catch (error) {
      throw new AutomifyError(`Unable to ${label}. Ensure Docker is running and image ${this.image} exists.`, {
        cause: error
      });
    }
  }

  async startupDiagnostics() {
    const sections = [];

    try {
      const { stdout } = await this.execFile(this.docker, [
        "inspect",
        "--format",
        "{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}",
        this.name
      ]);
      sections.push(`state: ${String(stdout).trim()}`);
    } catch (error) {
      sections.push(`state: unavailable (${shortError(error)})`);
    }

    try {
      const { stdout, stderr } = await this.execFile(this.docker, ["logs", "--tail", "80", this.name], {
        maxBuffer: this.options.logsMaxBuffer ?? 256 * 1024
      });
      const logs = `${stdout ?? ""}${stderr ?? ""}`.trim();
      if (logs) {
        sections.push(`logs:\n${logs}`);
      }
    } catch (error) {
      sections.push(`logs: unavailable (${shortError(error)})`);
    }

    return sections.join("\n");
  }

  async close() {
    if (this.created && !this.options.existingContainer && !this.options.keepContainer) {
      debugVirtualDesktop(this.options, "container_close", { containerName: this.name });
      await this.execFile(this.docker, ["rm", "-f", this.name]).catch(() => {});
    }
    await this.sharedFolder?.close();
    this.started = false;
    this.created = false;
  }
}

export const createVirtualDesktopComputer = createDockerDesktopComputer;
export const DockerVirtualDesktopSession = DockerDesktopSession;

async function acquireDockerDesktopLock(options) {
  if (!options.containerName) return null;
  return acquireAdapterLock(`docker-desktop:${options.containerName}`, {
    label: `Docker desktop container ${JSON.stringify(options.containerName)}`
  });
}

function normalizeVirtualDesktopOptions(options = {}) {
  assertKnownOptions("Docker desktop adapter", options, VIRTUAL_DESKTOP_OPTION_KEYS);
  assertKnownOptions("Docker desktop container", options.container, VIRTUAL_DESKTOP_CONTAINER_KEYS);
  assertKnownOptions("Docker desktop desktop", options.desktop, VIRTUAL_DESKTOP_DESKTOP_KEYS);
  options = applyDockerDesktopPreset(options);
  const container = options.container ?? {};
  const viewport = options.viewport ?? {};
  const desktop = options.desktop ?? {};
  const normalized = {
    ...options,
    debug: options.debug ?? false,
    logFile: normalizeLogFile(options.logFile, "Docker desktop adapter logFile"),
    dockerCommand: options.dockerCommand ?? container.dockerCommand ?? container.docker,
    image: options.image ?? container.image,
    containerName: options.containerName ?? container.name,
    existingContainer: options.existingContainer ?? container.existing,
    keepContainer: options.keepContainer ?? container.keep,
    autoRemove: options.autoRemove ?? container.autoRemove,
    sandbox: options.sandbox ?? container.sandbox,
    readOnly: options.readOnly ?? container.readOnly,
    network: options.network ?? container.network,
    cpus: options.cpus ?? container.cpus,
    memory: options.memory ?? container.memory,
    memorySwap: options.memorySwap ?? container.memorySwap,
    cpuShares: options.cpuShares ?? container.cpuShares,
    cpusetCpus: options.cpusetCpus ?? container.cpusetCpus,
    pidsLimit: options.pidsLimit ?? container.pidsLimit,
    shmSize: options.shmSize ?? container.shmSize,
    tmpfsTmp: options.tmpfsTmp ?? container.tmpfsTmp,
    tmpfsRun: options.tmpfsRun ?? container.tmpfsRun,
    volumes: options.volumes ?? container.volumes,
    env: options.env ?? container.env,
    dockerTimeoutMs: options.dockerTimeoutMs ?? container.timeoutMs,
    displayWidth: options.displayWidth ?? viewport.width,
    displayHeight: options.displayHeight ?? viewport.height,
    displayDepth: options.displayDepth ?? viewport.depth,
    startupCommand: options.startupCommand ?? desktop.startupCommand,
    windowManagerCommand: options.windowManagerCommand ?? desktop.windowManagerCommand,
    desktopPackages: options.desktopPackages ?? desktop.packages ?? container.packages,
    additionalAptPackages:
      options.additionalAptPackages ?? desktop.additionalAptPackages ?? container.additionalAptPackages,
    installDependencies: options.installDependencies ?? desktop.installDependencies ?? container.installDependencies,
    packageManager: options.packageManager ?? desktop.packageManager,
    sharedFolder: options.sharedFolder ?? options.shared,
    files: options.files ?? options.sharedFiles
  };
  validateDockerDesktopStartupCommand(normalized);
  return normalized;
}

function validateDockerDesktopStartupCommand(options) {
  if (typeof options.startupCommand === "string" && options.startupCommand.trim()) return;
  throw new AutomifyError(
    "Docker desktop startupCommand is required. Pass a non-empty startupCommand or desktop.startupCommand."
  );
}

function debugVirtualDesktop(options, message, details) {
  writeDebugLogFile(options.logFile, "automify:docker-desktop", message, details, { silent: options.silent });
  debugLog(options.debug, "automify:docker-desktop", message, details, { silent: options.silent });
}

function summarizeDockerArgs(args) {
  return args.map((arg) => (String(arg).length > 160 ? `${String(arg).slice(0, 157)}...` : arg));
}

export function dockerDesktopDockerfile() {
  return `FROM ${DEFAULT_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \\
  && apt-get install -y --no-install-recommends \\
    xvfb openbox xterm x11-utils xdotool imagemagick scrot ca-certificates \\
  && rm -rf /var/lib/apt/lists/*
`;
}

export function defaultDockerDesktopImage() {
  return DEFAULT_IMAGE;
}

export const virtualDesktopDockerfile = dockerDesktopDockerfile;
export const defaultVirtualDesktopImage = defaultDockerDesktopImage;

function keys(values) {
  const normalized = values.map((value) => key(value)).filter(Boolean);
  if (normalized.length === 0) {
    throw new AutomifyError("keypress action did not include any keys.");
  }
  return normalized;
}

function key(value) {
  const raw = String(value ?? "").trim();
  const lower = raw.toLowerCase().replace(/\s+/g, "_");
  const aliases = {
    alt: "Alt",
    backspace: "BackSpace",
    cmd: "Super",
    command: "Super",
    control: "Control",
    ctrl: "Control",
    delete: "Delete",
    down: "Down",
    enter: "Return",
    esc: "Escape",
    escape: "Escape",
    left: "Left",
    meta: "Super",
    option: "Alt",
    return: "Return",
    right: "Right",
    shift: "Shift",
    space: "space",
    tab: "Tab",
    up: "Up"
  };
  return aliases[lower] ?? raw;
}

function button(value) {
  if (value === "right") return "3";
  if (value === "middle") return "2";
  return "1";
}

function x(value) {
  return String(Math.max(0, Math.round(Number(value) || 0)));
}

function y(value) {
  return String(Math.max(0, Math.round(Number(value) || 0)));
}

function normalizeDisplay(display) {
  const value = String(display || DEFAULT_DISPLAY).trim();
  return value.startsWith(":") ? value : `:${value}`;
}

function dockerNetwork(value) {
  if (value === false || value === "none") return "none";
  if (typeof value === "string" && value.trim()) return value.trim();
  return "bridge";
}

function isBaseLinuxImage(image) {
  const normalized = String(image || "").toLowerCase();
  return ["ubuntu:", "debian:"].some((prefix) => normalized.startsWith(prefix));
}

function shortError(error) {
  return String(error?.stderr || error?.message || error)
    .trim()
    .split("\n")[0];
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

function appendDockerResourceArgs(args, options) {
  const cpus = positiveNumber(options.cpus);
  if (cpus != null) {
    args.push("--cpus", String(cpus));
  }
  appendNonEmptyArg(args, "--memory", options.memory);
  appendNonEmptyArg(args, "--memory-swap", options.memorySwap);

  const cpuShares = positiveInteger(options.cpuShares);
  if (cpuShares != null) {
    args.push("--cpu-shares", String(cpuShares));
  }
  appendNonEmptyArg(args, "--cpuset-cpus", options.cpusetCpus);
}

function appendNonEmptyArg(args, flag, value) {
  if (value == null || value === false) return;
  const normalized = String(value).trim();
  if (normalized) args.push(flag, normalized);
}

function positiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function uniquePackages(packages) {
  return [...new Set(packages.map((pkg) => String(pkg).trim()).filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
