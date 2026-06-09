import { randomUUID } from "node:crypto";
import { execFile, spawn as spawnProcess } from "node:child_process";
import { promisify } from "node:util";

import { CliAutomify } from "./cli-automify.js";
import { AutomifyError } from "./errors.js";
import { applyVirtualCliPreset } from "./presets.js";
import {
  AUTOMIFY_OPTION_KEYS,
  assertKnownOptions,
  debugLog,
  mergeOptionKeys,
  normalizeLogFile,
  writeDebugLogFile
} from "./runtime.js";
import { prepareVirtualSharedFolder } from "./virtual-shared-folder.js";
import {
  buildQemuArgs,
  defaultQemuCommand,
  getAvailablePort,
  installCommand,
  mountSharedFolderCommand,
  normalizeGuestPath,
  prepareDefaultQemuImage,
  positiveInteger,
  shellQuote,
  sshArgs,
  stopQemuProcess,
  uniquePackages,
  waitForSsh
} from "./qemu-runtime.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CWD = "/workspace";
const DEFAULT_TIMEOUT_MS = 30_000;
const VIRTUAL_CLI_OPTION_KEYS = mergeOptionKeys(AUTOMIFY_OPTION_KEYS, [
  "preset",
  "command",
  "commands",
  "cwd",
  "env",
  "shell",
  "timeoutMs",
  "runner",
  "confirmCommand",
  "approval",
  "allowedCommands",
  "blockedCommands",
  "instructions",
  "logFile",
  "session",
  "vm",
  "qemuCommand",
  "qemuImgCommand",
  "qemuImageCacheDir",
  "qemuImageUrl",
  "defaultImageCache",
  "createCloudInitServer",
  "image",
  "diskImage",
  "diskFormat",
  "vmName",
  "existingVM",
  "keepVM",
  "workdir",
  "workspacePath",
  "guestCwd",
  "startupCommand",
  "packages",
  "additionalAptPackages",
  "installDependencies",
  "memory",
  "cpus",
  "accel",
  "machine",
  "cpu",
  "firmware",
  "network",
  "networkDevice",
  "extraQemuArgs",
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
  "shared",
  "sharedFolder",
  "sharedFiles",
  "files",
  "sharedMode",
  "sharedTag",
  "sharedSecurityModel",
  "startupTimeoutMs",
  "qemuTimeoutMs",
  "commandMaxBuffer",
  "execFile",
  "spawn"
]);
export const VIRTUAL_CLI_AUTOMIFY_OPTION_KEYS = VIRTUAL_CLI_OPTION_KEYS;

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
const QEMU_SSH_KEYS = new Set(["command", "host", "port", "user", "keyPath", "options", "timeoutMs", "sudo"]);

export function createVirtualCliAutomify(options = {}) {
  options = normalizeVirtualCliOptions(options);
  return new VirtualCliAutomify(options);
}

export class VirtualCliAutomify extends CliAutomify {
  constructor(options = {}) {
    options = normalizeVirtualCliOptions(options);
    const session = options.session ?? new QemuCliSession(options);
    super({
      ...cliOptionsFromVirtualOptions(options),
      cwd: options.cwd ?? session.cwd,
      runner: options.runner ?? ((command, runOptions) => session.run(command, runOptions))
    });
    this.session = session;
  }

  get sharedFolder() {
    return this.session.sharedFolder?.data;
  }

  async do(instruction, runOptions = {}, maybeOptions) {
    await this.session.prepareSharedFolder();
    if (runOptions && typeof runOptions === "object" && !Array.isArray(runOptions)) {
      const data = runOptions.data;
      const canAttachSharedFolder =
        data && typeof data === "object" && !Array.isArray(data) && data.sharedFolder == null && this.sharedFolder;

      if (canAttachSharedFolder) {
        return super.do(
          instruction,
          {
            ...runOptions,
            data: {
              ...data,
              sharedFolder: this.sharedFolder
            }
          },
          maybeOptions
        );
      }
    }

    return super.do(instruction, runOptions, maybeOptions);
  }

  async close() {
    await this.session.close();
  }
}

export class QemuCliSession {
  constructor(options = {}) {
    options = normalizeVirtualCliOptions(options);
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
    this.usesDefaultImage = !this.image && !options.existingVM;
    this.name = options.vmName ?? `automify-vm-cli-${randomUUID()}`;
    this.cwd = normalizeGuestPath(options.cwd, DEFAULT_CWD);
    this.sshPort = positiveInteger(options.sshPort);
    this.started = false;
    this.created = false;
    this.sharedFolder = null;
    this.process = null;
  }

  async prepareSharedFolder() {
    if (this.sharedFolder) return this.sharedFolder;
    this.sharedFolder = await prepareVirtualSharedFolder(
      { ...this.options, keepContainer: this.options.keepVM },
      {
        prefix: "automify-qemu-cli-",
        containerPath: this.cwd
      }
    );
    return this.sharedFolder;
  }

  async start() {
    if (this.started) return;
    await this.prepareSharedFolder();
    if (!this.sshPort) this.sshPort = await getAvailablePort();

    if (this.options.existingVM) {
      debugVirtualCli(this.options, "use_existing_vm", { vmName: this.name, sshPort: this.sshPort });
      this.started = true;
      return;
    }

    try {
      await this.prepareDefaultImage();
      const args = buildQemuArgs({
        ...this.options,
        name: this.name,
        image: this.image,
        sshPort: this.sshPort,
        sharedFolder: this.sharedFolder
      });
      debugVirtualCli(this.options, "vm_start", {
        vmName: this.name,
        qemu: this.qemu,
        image: this.image,
        sshPort: this.sshPort
      });
      this.process = this.spawn(this.qemu, args, {
        stdio: "ignore"
      });
      this.process.unref?.();
      this.created = true;
      this.started = true;
      await waitForSsh(this.execFile, this.sshCommand, this.sshOptions());
      await this.runSsh(this.startupScript(), {
        timeout: positiveInteger(this.options.timeoutMs) ?? DEFAULT_TIMEOUT_MS
      });
      debugVirtualCli(this.options, "vm_ready", { vmName: this.name });
    } catch (error) {
      await this.close();
      throw new AutomifyError("QEMU virtual CLI did not become ready before startupTimeoutMs.", {
        cause: error
      });
    }
  }

  async prepareDefaultImage() {
    if (!this.usesDefaultImage || this.defaultImage) return;
    debugVirtualCli(this.options, "default_image_prepare", {
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
      timeoutMs: this.options.timeoutMs,
      qemuTimeoutMs: this.options.qemuTimeoutMs,
      createCloudInitServer: this.options.createCloudInitServer,
      spawn: this.spawn,
      vmName: this.name
    });
    this.defaultImage = prepared;
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
    debugVirtualCli(this.options, "default_image_ready", {
      vmName: this.name,
      image: prepared.image,
      baseImage: prepared.baseImage
    });
  }

  startupScript() {
    const packages = uniquePackages([...(this.options.packages ?? []), ...(this.options.additionalAptPackages ?? [])]);
    const startupCommand = this.options.startupCommand ?? ":";
    return [
      installCommand(packages, this.options),
      mountSharedFolderCommand(this.sharedFolder, this.options),
      `${this.options.sudo ? "sudo -n " : ""}mkdir -p ${shellQuote(this.cwd)}`,
      startupCommand
    ].join(" && ");
  }

  async run(command, options = {}) {
    await this.start();
    const cwd = normalizeGuestPath(options.cwd ?? this.cwd, this.cwd);
    const timeoutMs =
      positiveInteger(options.timeoutMs) ?? positiveInteger(this.options.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
    const envPrefix = Object.entries(options.env ?? {})
      .map(([key, value]) => `${shellEnvName(key)}=${shellQuote(value)}`)
      .join(" ");
    const remoteCommand = [
      `cd ${shellQuote(cwd)}`,
      envPrefix ? `${envPrefix} sh -lc ${shellQuote(command)}` : `sh -lc ${shellQuote(command)}`
    ].join(" && ");

    debugVirtualCli(this.options, "command", { command: { command, cwd, timeoutMs } });
    try {
      const { stdout, stderr } = await this.runSsh(remoteCommand, {
        timeout: timeoutMs,
        maxBuffer: this.options.commandMaxBuffer ?? 10 * 1024 * 1024
      });
      const result = {
        command,
        cwd,
        exitCode: 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        timedOut: false
      };
      debugVirtualCli(this.options, "command_result", summarizeCommandResult(result));
      return result;
    } catch (error) {
      const result = {
        command,
        cwd,
        exitCode: typeof error.code === "number" ? error.code : null,
        signal: error.signal,
        stdout: String(error.stdout ?? ""),
        stderr: String(error.stderr || error.message || ""),
        timedOut: error.killed === true || error.signal === "SIGTERM"
      };
      debugVirtualCli(this.options, "command_result", summarizeCommandResult(result));
      return result;
    }
  }

  async runSsh(command, options = {}) {
    return this.execFile(this.sshCommand, sshArgs(this.sshOptions(), command), options);
  }

  sshOptions() {
    return {
      ...this.options,
      sshPort: this.sshPort
    };
  }

  async close() {
    if (this.created && !this.options.existingVM && !this.options.keepVM) {
      debugVirtualCli(this.options, "vm_close", { vmName: this.name });
      await stopQemuProcess(this.process, positiveInteger(this.options.qemuTimeoutMs) ?? 1500);
    }
    await this.defaultImage?.close();
    this.defaultImage = null;
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

export const QemuVirtualCliSession = QemuCliSession;

function normalizeVirtualCliOptions(options = {}) {
  assertKnownOptions("QEMU virtual CLI adapter", options, VIRTUAL_CLI_OPTION_KEYS);
  assertKnownOptions("QEMU virtual CLI vm", options.vm, QEMU_VM_KEYS);
  assertKnownOptions("QEMU virtual CLI ssh", options.ssh, QEMU_SSH_KEYS);
  options = applyVirtualCliPreset(options);
  const vm = options.vm ?? {};
  const ssh = options.ssh ?? {};
  const cwd = options.cwd ?? options.workdir ?? options.workspacePath ?? options.guestCwd;

  return {
    ...options,
    debug: options.debug ?? false,
    logFile: normalizeLogFile(options.logFile, "QEMU virtual CLI logFile"),
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
    cwd,
    additionalAptPackages: options.additionalAptPackages,
    sharedFolder: options.sharedFolder ?? options.shared,
    files: options.files ?? options.sharedFiles
  };
}

function cliOptionsFromVirtualOptions(options) {
  const {
    openaiApiKey,
    client,
    model,
    baseURL,
    fetchImpl,
    maxSteps,
    limits,
    request,
    requestOptions,
    command,
    commands,
    cwd,
    env,
    shell,
    timeoutMs,
    runner,
    confirmCommand,
    approval,
    allowedCommands,
    blockedCommands,
    instructions,
    hooks,
    onStep,
    onRequest,
    onResponse,
    onComplete,
    debug,
    logFile,
    silent,
    reasoning,
    safetyIdentifier,
    preset
  } = options;

  return {
    openaiApiKey,
    client,
    model,
    baseURL,
    fetchImpl,
    maxSteps,
    limits,
    request,
    requestOptions,
    command,
    commands,
    cwd,
    env,
    shell,
    timeoutMs,
    runner,
    confirmCommand,
    approval,
    allowedCommands,
    blockedCommands,
    instructions,
    hooks,
    onStep,
    onRequest,
    onResponse,
    onComplete,
    debug,
    logFile,
    silent,
    reasoning,
    safetyIdentifier,
    preset
  };
}

function debugVirtualCli(options, message, details) {
  writeDebugLogFile(options.logFile, "automify:qemu-cli", message, details, { silent: options.silent });
  debugLog(options.debug, "automify:qemu-cli", message, details, { silent: options.silent });
}

function shellEnvName(value) {
  const key = String(value ?? "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new AutomifyError(`Invalid environment variable name: ${key}`);
  }
  return key;
}

function summarizeCommandResult(result) {
  return {
    command: {
      command: result.command,
      cwd: result.cwd
    },
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutLength: typeof result.stdout === "string" ? result.stdout.length : undefined,
    stderrLength: typeof result.stderr === "string" ? result.stderr.length : undefined
  };
}
