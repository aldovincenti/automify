import { randomUUID } from "node:crypto";
import { execFile, spawn as spawnProcess } from "node:child_process";
import { promisify } from "node:util";

import { acquireAdapterLock } from "./adapter-locks.js";
import { AutomifyError } from "./errors.js";
import { applyVirtualDesktopPreset } from "./presets.js";
import { assertKnownOptions, debugLog, normalizeLogFile, writeDebugLogFile } from "./runtime.js";
import { prepareVirtualSharedFolder } from "./virtual-shared-folder.js";
import {
  buildQemuArgs,
  defaultQemuBaseImagePath,
  defaultQemuCommand,
  getAvailablePort,
  installCommand,
  mountSharedFolderCommand,
  prepareDefaultQemuImage,
  positiveInteger,
  shellQuote,
  sleep,
  sshArgs,
  stopQemuProcess,
  uniquePackages,
  waitForSsh
} from "./qemu-runtime.js";

const execFileAsync = promisify(execFile);

const DEFAULT_ENVIRONMENT = "linux";
const DEFAULT_DISPLAY = ":99";
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const DEFAULT_DEPTH = 24;
export const DEFAULT_QEMU_DESKTOP_PACKAGES = [
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
  "You are controlling an isolated Linux desktop running in a QEMU virtual machine.",
  "Orient from the screenshot first: identify the active app, visible window, focused field, current page, and the specific target required by the task before acting.",
  "Use deterministic entry points. For a website or web app, use the browser address bar only when a browser is clearly focused; otherwise use a visible app icon, terminal command, launcher/search mechanism, or provided startup app. For app content, use visible search, filters, or navigation controls.",
  "Do not open or use Alt+Tab or other cyclic app/window switchers unless the task explicitly asks to switch to the previous app.",
  "Do not click as a probe. Click only when the screenshot shows a specific visible target and the purpose of that click is clear from the task or current UI.",
  "Treat the environment as ephemeral unless the task explicitly says the virtual machine disk is persistent.",
  "After any action that launches an app, navigates, submits input, changes windows, or might trigger loading, use the next screenshot to decide the next step."
].join("\n");

const QEMU_DESKTOP_OPTION_KEYS = new Set([
  "preset",
  "vm",
  "qemuCommand",
  "qemuImgCommand",
  "qemuImageCacheDir",
  "qemuImageUrl",
  "defaultImageCache",
  "createCloudInitServer",
  "fetchImpl",
  "image",
  "diskImage",
  "diskFormat",
  "vmName",
  "existingVM",
  "keepVM",
  "start",
  "ssh",
  "sshCommand",
  "sshKeygenCommand",
  "sshHost",
  "sshPort",
  "sshUser",
  "sshKeyPath",
  "sshOptions",
  "sshTimeoutMs",
  "sudo",
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
  "installDependencies",
  "desktopPackages",
  "additionalAptPackages",
  "memory",
  "cpus",
  "accel",
  "machine",
  "cpu",
  "firmware",
  "network",
  "networkDevice",
  "extraQemuArgs",
  "shared",
  "sharedFolder",
  "sharedFiles",
  "files",
  "sharedMode",
  "sharedTag",
  "sharedSecurityModel",
  "waitMs",
  "startupTimeoutMs",
  "qemuTimeoutMs",
  "commandTimeoutMs",
  "screenshotMaxBuffer",
  "screenshotSettleMs",
  "execFile",
  "spawn",
  "silent",
  "debug",
  "logFile",
  "onUnknownAction"
]);
export const VIRTUAL_DESKTOP_COMPUTER_OPTION_KEYS = QEMU_DESKTOP_OPTION_KEYS;

const QEMU_VM_KEYS = new Set([
  "qemu",
  "qemuCommand",
  "qemuImgCommand",
  "imageCacheDir",
  "imageUrl",
  "defaultImageCache",
  "image",
  "diskImage",
  "diskFormat",
  "name",
  "existing",
  "keep",
  "memory",
  "cpus",
  "accel",
  "machine",
  "cpu",
  "firmware",
  "network",
  "networkDevice",
  "extraArgs",
  "timeoutMs"
]);
const QEMU_DESKTOP_KEYS = new Set([
  "startupCommand",
  "windowManagerCommand",
  "packages",
  "additionalAptPackages",
  "installDependencies"
]);
const QEMU_SSH_KEYS = new Set(["command", "host", "port", "user", "keyPath", "options", "timeoutMs", "sudo"]);

export async function createVirtualDesktopComputer(options = {}) {
  options = normalizeVirtualDesktopOptions(options);
  const releaseLock = await acquireQemuDesktopLock(options);
  debugVirtualDesktop(options, "create", {
    image: options.image ?? null,
    vmName: options.vmName,
    start: options.start !== false
  });

  try {
    const session = new QemuDesktopSession(options);
    await session.prepareSharedFolder();
    if (options.start !== false) {
      await session.start();
    }

    const computer = {
      displayWidth: session.width,
      displayHeight: session.height,
      environment: options.environment ?? DEFAULT_ENVIRONMENT,
      instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,

      async execute(action, context) {
        await session.execute(action, context);
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

export class QemuDesktopSession {
  constructor(options = {}) {
    options = normalizeVirtualDesktopOptions(options);
    this.options = options;
    this.qemu = options.qemuCommand ?? defaultQemuCommand();
    this.sshCommand = options.sshCommand ?? "ssh";
    this.execFile = options.execFile ?? execFileAsync;
    this.spawn = options.spawn ?? spawnProcess;
    this.image = options.image;
    this.extraQemuArgs = options.extraQemuArgs ?? [];
    this.originalSshUser = options.sshUser;
    this.originalSshKeyPath = options.sshKeyPath;
    this.originalSudo = options.sudo;
    this.defaultImage = null;
    this.preparedPackages = new Set();
    this.usesDefaultImage = !this.image && !options.existingVM;
    this.name = options.vmName ?? `automify-vm-desktop-${randomUUID()}`;
    this.display = normalizeDisplay(options.display ?? DEFAULT_DISPLAY);
    this.width = positiveInteger(options.displayWidth) ?? DEFAULT_WIDTH;
    this.height = positiveInteger(options.displayHeight) ?? DEFAULT_HEIGHT;
    this.depth = positiveInteger(options.displayDepth) ?? DEFAULT_DEPTH;
    this.sshPort = positiveInteger(options.sshPort);
    this.sharedFolder = null;
    this.started = false;
    this.created = false;
    this.process = null;
  }

  async prepareSharedFolder() {
    if (this.sharedFolder) return this.sharedFolder;
    this.sharedFolder = await prepareVirtualSharedFolder(
      { ...this.options, keepContainer: this.options.keepVM },
      {
        prefix: "automify-qemu-desktop-"
      }
    );
    return this.sharedFolder;
  }

  async start() {
    if (this.started) return;
    await this.prepareSharedFolder();
    if (!this.sshPort) this.sshPort = await getAvailablePort();

    if (this.options.existingVM) {
      debugVirtualDesktop(this.options, "use_existing_vm", { vmName: this.name, sshPort: this.sshPort });
      this.started = true;
      return;
    }

    try {
      await this.prepareDefaultImage();
    } catch (error) {
      await this.close();
      throw error;
    }

    try {
      const args = buildQemuArgs({
        ...this.options,
        name: this.name,
        image: this.image,
        sshPort: this.sshPort,
        sharedFolder: this.sharedFolder
      });
      debugVirtualDesktop(this.options, "vm_start", {
        vmName: this.name,
        qemu: this.qemu,
        image: this.image,
        sshPort: this.sshPort,
        width: this.width,
        height: this.height
      });
      this.process = this.spawn(this.qemu, args, {
        stdio: "ignore"
      });
      this.process.unref?.();
      this.created = true;
      this.started = true;
      await waitForSsh(this.execFile, this.sshCommand, this.sshOptions());
      await this.runSsh(this.detachedStartupCommand(), {
        timeout: positiveInteger(this.options.commandTimeoutMs) ?? 30_000
      });
      await this.waitForReady();
      debugVirtualDesktop(this.options, "desktop_ready", { vmName: this.name, display: this.display });
    } catch (error) {
      await this.close();
      throw new AutomifyError("QEMU virtual desktop did not become ready before startupTimeoutMs.", {
        cause: error
      });
    }
  }

  async prepareDefaultImage() {
    if (!this.usesDefaultImage || this.defaultImage) return;
    debugVirtualDesktop(this.options, "default_image_prepare", {
      vmName: this.name,
      imageUrl: this.options.qemuImageUrl ?? process.env.AUTOMIFY_QEMU_DEFAULT_IMAGE_URL
    });
    const prepared = await prepareDefaultQemuImage({
      execFile: this.execFile,
      fetchImpl: this.options.fetchImpl,
      cacheDir: this.options.qemuImageCacheDir,
      imageUrl: this.options.qemuImageUrl,
      defaultImageCache: this.options.defaultImageCache,
      qemuImgCommand: this.options.qemuImgCommand,
      qemuCommand: this.qemu,
      memory: this.options.memory,
      cpus: this.options.cpus,
      accel: this.options.accel,
      machine: this.options.machine,
      cpu: this.options.cpu,
      firmware: this.options.firmware,
      networkDevice: this.options.networkDevice,
      sshKeygenCommand: this.options.sshKeygenCommand,
      sshCommand: this.sshCommand,
      sshPort: this.sshPort,
      sshTimeoutMs: this.options.sshTimeoutMs,
      startupTimeoutMs: this.options.startupTimeoutMs,
      timeoutMs: this.options.commandTimeoutMs,
      qemuTimeoutMs: this.options.qemuTimeoutMs,
      createCloudInitServer: this.options.createCloudInitServer,
      preparedImageProfile: "desktop",
      preparedPackages: this.options.installDependencies === false ? [] : this.dependencyPackages(),
      spawn: this.spawn,
      vmName: this.name
    });
    this.defaultImage = prepared;
    this.preparedPackages = new Set(prepared.preparedPackages ?? []);
    this.image = prepared.image;
    this.options = {
      ...this.options,
      image: prepared.image,
      diskFormat: this.options.diskFormat ?? prepared.diskFormat,
      sshUser: prepared.sshUser,
      sshKeyPath: prepared.sshKeyPath,
      sudo: this.options.sudo ?? prepared.sudo,
      extraQemuArgs: [...prepared.extraQemuArgs, ...this.extraQemuArgs]
    };
    debugVirtualDesktop(this.options, "default_image_ready", {
      vmName: this.name,
      image: prepared.image,
      baseImage: prepared.baseImage
    });
  }

  detachedStartupCommand() {
    return `nohup sh -lc ${shellQuote(this.startupScript())} >/tmp/automify-desktop-supervisor.log 2>&1 &`;
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
    return [
      this.dependencyInstallScript(),
      mountSharedFolderCommand(this.sharedFolder, this.options),
      `${xvfb} &`,
      "XVFB_PID=$!",
      "sleep 0.2",
      `${windowManager} >/tmp/automify-window-manager.log 2>&1 &`,
      `${app} >/tmp/automify-startup.log 2>&1 &`,
      "wait $XVFB_PID"
    ].join("\n");
  }

  dependencyInstallScript() {
    const packages = this.dependencyPackages().filter((pkg) => !this.preparedPackages.has(pkg));
    return installCommand(packages, this.options);
  }

  dependencyPackages() {
    return uniquePackages([
      ...(this.options.desktopPackages ?? DEFAULT_QEMU_DESKTOP_PACKAGES),
      ...(this.options.additionalAptPackages ?? [])
    ]);
  }

  async waitForReady() {
    const timeoutMs = positiveInteger(this.options.startupTimeoutMs) ?? 60_000;
    const startedAt = Date.now();
    let lastError;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.exec(["sh", "-lc", "xdpyinfo >/dev/null 2>&1"], {
          timeout: positiveInteger(this.options.sshTimeoutMs) ?? 5_000
        });
        return;
      } catch (error) {
        lastError = error;
        await sleep(250);
      }
    }

    throw lastError ?? new AutomifyError("QEMU virtual desktop readiness check timed out.");
  }

  async execute(action, context) {
    await this.start();
    if (!action || typeof action !== "object") {
      throw new AutomifyError("QEMU virtual desktop action must be an object.");
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
          await this.options.onUnknownAction(action, context);
          break;
        }
        throw new AutomifyError(`Unsupported QEMU virtual desktop action: ${action.type}`);
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
    const { stdout } = await this.exec(["sh", "-lc", "scrot -o - 2>/dev/null || import -window root -screen png:-"], {
      encoding: "buffer",
      maxBuffer: this.options.screenshotMaxBuffer ?? 20 * 1024 * 1024
    });
    debugVirtualDesktop(this.options, "screenshot", {
      phase: context?.final ? "final" : context?.initial ? "initial" : "step",
      bytes: stdout?.byteLength,
      durationMs: Date.now() - startedAt
    });
    return stdout;
  }

  async exec(args, options = {}) {
    return this.runSsh(`DISPLAY=${shellQuote(this.display)} ${args.map(shellQuote).join(" ")}`, options);
  }

  async runSsh(command, options = {}) {
    return this.execFile(this.sshCommand, sshArgs(this.sshOptions(), command), {
      timeout: positiveInteger(this.options.commandTimeoutMs) ?? 30_000,
      ...options
    });
  }

  sshOptions() {
    return {
      ...this.options,
      sshPort: this.sshPort
    };
  }

  async close() {
    if (this.created && !this.options.existingVM && !this.options.keepVM) {
      debugVirtualDesktop(this.options, "vm_close", { vmName: this.name });
      await stopQemuProcess(this.process, positiveInteger(this.options.qemuTimeoutMs) ?? 1500);
    }
    await this.defaultImage?.close();
    this.defaultImage = null;
    this.preparedPackages = new Set();
    if (this.usesDefaultImage) {
      this.image = null;
      this.options = {
        ...this.options,
        image: undefined,
        sshUser: this.originalSshUser,
        sshKeyPath: this.originalSshKeyPath,
        sudo: this.originalSudo,
        extraQemuArgs: this.extraQemuArgs
      };
    }
    await this.sharedFolder?.close();
    this.started = false;
    this.created = false;
  }
}

export function defaultVirtualDesktopImage() {
  return process.env.AUTOMIFY_QEMU_IMAGE ?? defaultQemuBaseImagePath();
}

function normalizeVirtualDesktopOptions(options = {}) {
  assertKnownOptions("QEMU virtual desktop adapter", options, QEMU_DESKTOP_OPTION_KEYS);
  assertKnownOptions("QEMU virtual desktop vm", options.vm, QEMU_VM_KEYS);
  assertKnownOptions("QEMU virtual desktop desktop", options.desktop, QEMU_DESKTOP_KEYS);
  assertKnownOptions("QEMU virtual desktop ssh", options.ssh, QEMU_SSH_KEYS);
  options = applyVirtualDesktopPreset(options);
  const vm = options.vm ?? {};
  const viewport = options.viewport ?? {};
  const desktop = options.desktop ?? {};
  const ssh = options.ssh ?? {};
  const normalized = {
    ...options,
    debug: options.debug ?? false,
    logFile: normalizeLogFile(options.logFile, "QEMU virtual desktop logFile"),
    qemuCommand: options.qemuCommand ?? vm.qemuCommand ?? vm.qemu,
    qemuImgCommand: options.qemuImgCommand ?? vm.qemuImgCommand ?? vm.imgCommand,
    qemuImageCacheDir: options.qemuImageCacheDir ?? vm.imageCacheDir,
    qemuImageUrl: options.qemuImageUrl ?? vm.imageUrl,
    defaultImageCache: options.defaultImageCache ?? vm.defaultImageCache,
    image: options.image ?? options.diskImage ?? vm.image ?? vm.diskImage ?? process.env.AUTOMIFY_QEMU_IMAGE,
    diskFormat: options.diskFormat ?? vm.diskFormat,
    vmName: options.vmName ?? vm.name,
    existingVM: options.existingVM ?? vm.existing,
    keepVM: options.keepVM ?? vm.keep,
    memory: options.memory ?? vm.memory,
    cpus: options.cpus ?? vm.cpus,
    accel: options.accel ?? vm.accel,
    machine: options.machine ?? vm.machine,
    cpu: options.cpu ?? vm.cpu,
    firmware: options.firmware ?? vm.firmware,
    network: options.network ?? vm.network,
    networkDevice: options.networkDevice ?? vm.networkDevice,
    extraQemuArgs: options.extraQemuArgs ?? vm.extraArgs,
    qemuTimeoutMs: options.qemuTimeoutMs ?? vm.timeoutMs,
    sshCommand: options.sshCommand ?? ssh.command,
    sshKeygenCommand: options.sshKeygenCommand,
    sshHost: options.sshHost ?? ssh.host,
    sshPort: options.sshPort ?? ssh.port,
    sshUser: options.sshUser ?? ssh.user,
    sshKeyPath: options.sshKeyPath ?? ssh.keyPath,
    sshOptions: options.sshOptions ?? ssh.options,
    sshTimeoutMs: options.sshTimeoutMs ?? ssh.timeoutMs,
    sudo: options.sudo ?? ssh.sudo,
    displayWidth: options.displayWidth ?? viewport.width,
    displayHeight: options.displayHeight ?? viewport.height,
    displayDepth: options.displayDepth ?? viewport.depth,
    startupCommand: options.startupCommand ?? desktop.startupCommand,
    windowManagerCommand: options.windowManagerCommand ?? desktop.windowManagerCommand,
    desktopPackages: options.desktopPackages ?? desktop.packages,
    additionalAptPackages: options.additionalAptPackages ?? desktop.additionalAptPackages,
    installDependencies: options.installDependencies ?? desktop.installDependencies,
    sharedFolder: options.sharedFolder ?? options.shared,
    sharedMode: options.sharedMode ?? (process.platform === "win32" ? "none" : undefined),
    files: options.files ?? options.sharedFiles
  };
  validateStartupCommand(normalized);
  return normalized;
}

function validateStartupCommand(options) {
  if (typeof options.startupCommand === "string" && options.startupCommand.trim()) return;
  throw new AutomifyError(
    "QEMU virtual desktop startupCommand is required. Pass a non-empty startupCommand or desktop.startupCommand."
  );
}

async function acquireQemuDesktopLock(options) {
  if (!options.vmName) return null;
  return acquireAdapterLock(`qemu-desktop:${options.vmName}`, {
    label: `QEMU virtual desktop ${JSON.stringify(options.vmName)}`
  });
}

function debugVirtualDesktop(options, message, details) {
  writeDebugLogFile(options.logFile, "automify:qemu-desktop", message, details, { silent: options.silent });
  debugLog(options.debug, "automify:qemu-desktop", message, details, { silent: options.silent });
}

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
