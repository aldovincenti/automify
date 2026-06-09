import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CliAutomify } from "./cli-automify.js";
import { AutomifyError } from "./errors.js";
import { applyDockerCliPreset } from "./presets.js";
import {
  AUTOMIFY_OPTION_KEYS,
  assertKnownOptions,
  debugLog,
  mergeOptionKeys,
  normalizeLogFile,
  writeDebugLogFile
} from "./runtime.js";
import { prepareVirtualSharedFolder } from "./virtual-shared-folder.js";

const execFileAsync = promisify(execFile);

const DEFAULT_IMAGE = "debian:bookworm-slim";
const DEFAULT_CWD = "/workspace";
const DEFAULT_TIMEOUT_MS = 30_000;
const DOCKER_CLI_OPTION_KEYS = mergeOptionKeys(AUTOMIFY_OPTION_KEYS, [
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
  "container",
  "dockerCommand",
  "image",
  "containerName",
  "existingContainer",
  "keepContainer",
  "workdir",
  "workspacePath",
  "containerCwd",
  "startupCommand",
  "packages",
  "additionalAptPackages",
  "installDependencies",
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
  "containerEnv",
  "shared",
  "sharedFolder",
  "sharedFiles",
  "files",
  "dockerTimeoutMs",
  "commandMaxBuffer",
  "execFile"
]);
const CONTAINER_OPTION_KEYS = new Set([
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
  "volumes",
  "env",
  "timeoutMs",
  "cwd",
  "workdir",
  "packages",
  "additionalAptPackages",
  "installDependencies",
  "startupCommand"
]);

export function createDockerCliAutomify(options = {}) {
  options = normalizeVirtualCliOptions(options);
  return new DockerCliAutomify(options);
}

export class DockerCliAutomify extends CliAutomify {
  constructor(options = {}) {
    options = normalizeVirtualCliOptions(options);
    const session = options.session ?? new DockerCliSession(options);
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

export class DockerCliSession {
  constructor(options = {}) {
    options = normalizeVirtualCliOptions(options);
    this.options = options;
    this.docker = options.dockerCommand ?? "docker";
    this.execFile = options.execFile ?? execFileAsync;
    this.image = options.image ?? DEFAULT_IMAGE;
    this.name = options.containerName ?? `automify-cli-${randomUUID()}`;
    this.cwd = normalizeContainerPath(options.cwd ?? DEFAULT_CWD);
    this.started = false;
    this.created = false;
    this.sharedFolder = null;
  }

  async prepareSharedFolder() {
    if (this.sharedFolder) return this.sharedFolder;
    this.sharedFolder = await prepareVirtualSharedFolder(this.options, {
      prefix: "automify-docker-cli-",
      containerPath: this.cwd
    });
    return this.sharedFolder;
  }

  async start() {
    if (this.started) return;
    await this.prepareSharedFolder();
    if (this.options.existingContainer) {
      debugVirtualCli(this.options, "use_existing_container", { containerName: this.name });
      this.started = true;
      return;
    }

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
      String(this.options.shmSize ?? "512m"),
      "--workdir",
      this.cwd
    ];
    appendDockerResourceArgs(args, this.options);

    if (this.options.autoRemove === true) {
      args.splice(2, 0, "--rm");
    }
    const installsDependencies = dockerCliInstallsDependencies(this.options);
    if (this.options.sandbox !== false && !installsDependencies) {
      args.push("--cap-drop", "ALL", "--security-opt", "no-new-privileges");
    }
    if (this.options.readOnly === true && !installsDependencies) {
      args.push("--read-only", "--tmpfs", String(this.options.tmpfsTmp ?? "/tmp:exec,nosuid,nodev,size=512m"));
    }
    for (const volume of this.options.volumes ?? []) {
      args.push("-v", String(volume));
    }
    if (this.sharedFolder) {
      args.push("-v", this.sharedFolder.volume);
    }
    for (const env of this.options.containerEnv ?? []) {
      args.push("-e", String(env));
    }

    args.push(this.image, "sh", "-lc", dockerCliStartupCommand(this.options));
    await this.runDocker(args, "start Docker CLI container");
    this.created = true;
    this.started = true;
    debugVirtualCli(this.options, "container_ready", { containerName: this.name, image: this.image });
  }

  async run(command, options = {}) {
    await this.start();
    const cwd = normalizeContainerPath(options.cwd ?? this.cwd);
    const timeoutMs =
      positiveInteger(options.timeoutMs) ?? positiveInteger(this.options.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
    const envArgs = [];
    for (const [key, value] of Object.entries(options.env ?? {})) {
      envArgs.push("-e", `${key}=${value}`);
    }

    debugVirtualCli(this.options, "command", { command: { command, cwd, timeoutMs } });
    try {
      const { stdout, stderr } = await this.execFile(
        this.docker,
        ["exec", "--workdir", cwd, ...envArgs, this.name, "sh", "-lc", command],
        {
          timeout: timeoutMs,
          maxBuffer: this.options.commandMaxBuffer ?? 10 * 1024 * 1024
        }
      );
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

  async runDocker(args, label) {
    debugVirtualCli(this.options, "docker", { label, args });
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

  async close() {
    if (this.created && !this.options.existingContainer && !this.options.keepContainer) {
      debugVirtualCli(this.options, "container_close", { containerName: this.name });
      await this.execFile(this.docker, ["rm", "-f", this.name]).catch(() => {});
    }
    await this.sharedFolder?.close();
    this.started = false;
    this.created = false;
  }
}

function normalizeVirtualCliOptions(options = {}) {
  assertKnownOptions("Docker CLI adapter", options, DOCKER_CLI_OPTION_KEYS);
  assertKnownOptions("Docker CLI container", options.container, CONTAINER_OPTION_KEYS);
  options = applyDockerCliPreset(options);
  const container = options.container ?? {};
  const cwd =
    options.cwd ??
    options.workdir ??
    options.workspacePath ??
    options.containerCwd ??
    container.cwd ??
    container.workdir;

  return {
    ...options,
    debug: options.debug ?? false,
    logFile: normalizeLogFile(options.logFile, "Docker CLI logFile"),
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
    volumes: options.volumes ?? container.volumes,
    containerEnv: options.containerEnv ?? container.env,
    dockerTimeoutMs: options.dockerTimeoutMs ?? container.timeoutMs,
    packages: options.packages ?? container.packages,
    additionalAptPackages: options.additionalAptPackages ?? container.additionalAptPackages,
    installDependencies: options.installDependencies ?? container.installDependencies,
    startupCommand: options.startupCommand ?? container.startupCommand,
    cwd,
    sharedFolder: options.sharedFolder ?? options.shared,
    files: options.files ?? options.sharedFiles
  };
}

function dockerCliStartupCommand(options) {
  const startupCommand = options.startupCommand ?? "sleep infinity";
  const installCommand = dockerCliInstallCommand(options);
  return installCommand ? `${installCommand} && ${startupCommand}` : startupCommand;
}

function dockerCliInstallsDependencies(options) {
  return Boolean(dockerCliInstallCommand(options));
}

function dockerCliInstallCommand(options) {
  if (options.installDependencies === false) return "";

  const packages = uniquePackages([...(options.packages ?? []), ...(options.additionalAptPackages ?? [])]);
  if (packages.length === 0) return "";

  return [
    "apt-get update",
    `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${packages.map(shellQuote).join(" ")}`,
    "rm -rf /var/lib/apt/lists/*"
  ].join(" && ");
}

function uniquePackages(packages) {
  return [...new Set(packages.map((pkg) => String(pkg).trim()).filter(Boolean))];
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
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
  writeDebugLogFile(options.logFile, "automify:docker-cli", message, details, { silent: options.silent });
  debugLog(options.debug, "automify:docker-cli", message, details, { silent: options.silent });
}

function dockerNetwork(value) {
  if (value === false || value === "none") return "none";
  if (typeof value === "string" && value.trim()) return value.trim();
  return "bridge";
}

function normalizeContainerPath(value) {
  const path = String(value || DEFAULT_CWD).trim();
  return path.startsWith("/") ? path : `/${path}`;
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
