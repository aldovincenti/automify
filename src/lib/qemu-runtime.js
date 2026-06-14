import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { createServer as createHttpServer, get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createServer as createNetServer } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { AutomifyError } from "./errors.js";

export const DEFAULT_QEMU_MEMORY = "2g";
export const DEFAULT_QEMU_CPUS = 2;
export const DEFAULT_QEMU_SSH_HOST = "127.0.0.1";
export const DEFAULT_QEMU_SSH_USER = "root";
export const DEFAULT_QEMU_DEBIAN_RELEASE = "trixie";
export const DEFAULT_QEMU_DEBIAN_VERSION = "13";
export const DEFAULT_QEMU_PREPARED_IMAGE_VERSION = "v2";
const DEFAULT_QEMU_IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_QEMU_IMAGE_DOWNLOAD_REDIRECTS = 5;

const execFileAsync = promisify(execFileCallback);

export function defaultQemuCommand() {
  switch (process.arch) {
    case "arm64":
      return "qemu-system-aarch64";
    case "x64":
      return "qemu-system-x86_64";
    default:
      return `qemu-system-${process.arch}`;
  }
}

export function defaultQemuAccel() {
  switch (process.platform) {
    case "darwin":
      return "hvf";
    case "linux":
      return "kvm";
    case "win32":
      return "whpx";
    default:
      return "tcg";
  }
}

export function defaultQemuFirmware(env = process.env) {
  if (env.AUTOMIFY_QEMU_FIRMWARE) return env.AUTOMIFY_QEMU_FIRMWARE;
  if (process.arch !== "arm64") return null;

  const homebrewPrefix = env.HOMEBREW_PREFIX;
  const candidates = [
    homebrewPrefix ? join(homebrewPrefix, "share", "qemu", "edk2-aarch64-code.fd") : null,
    "/opt/homebrew/share/qemu/edk2-aarch64-code.fd",
    "/usr/local/share/qemu/edk2-aarch64-code.fd",
    "/usr/share/qemu-efi-aarch64/QEMU_EFI.fd",
    "/usr/share/AAVMF/AAVMF_CODE.fd",
    "/usr/share/edk2/aarch64/QEMU_EFI.fd",
    "/usr/share/qemu/edk2-aarch64-code.fd"
  ].filter(Boolean);

  return candidates.find((path) => existsSync(path)) ?? null;
}

export function defaultQemuCpu(options = {}) {
  if (process.arch !== "arm64") return null;
  const accel = options.accel ?? defaultQemuAccel();
  if (accel === "hvf" || accel === "kvm") return "host";
  return null;
}

export async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

export function defaultQemuImageUrl(env = process.env) {
  if (env.AUTOMIFY_QEMU_DEFAULT_IMAGE_URL) return env.AUTOMIFY_QEMU_DEFAULT_IMAGE_URL;
  const arch = debianCloudImageArch();
  return `https://cloud.debian.org/images/cloud/${DEFAULT_QEMU_DEBIAN_RELEASE}/latest/debian-${DEFAULT_QEMU_DEBIAN_VERSION}-genericcloud-${arch}.qcow2`;
}

export function defaultQemuImageCacheRoot(env = process.env) {
  if (env.AUTOMIFY_QEMU_IMAGE_CACHE_DIR) return resolve(env.AUTOMIFY_QEMU_IMAGE_CACHE_DIR);
  if (process.platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "automify", "qemu-images");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "automify", "qemu-images");
  }
  return join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "automify", "qemu-images");
}

export function defaultQemuPreparedImageCacheRoot(env = process.env) {
  if (env.AUTOMIFY_QEMU_PREPARED_IMAGE_CACHE_DIR) return resolve(env.AUTOMIFY_QEMU_PREPARED_IMAGE_CACHE_DIR);
  return join(defaultQemuImageCacheRoot(env), "prepared");
}

export function defaultQemuBaseImagePath(env = process.env) {
  return join(defaultQemuImageCacheRoot(env), basename(new URL(defaultQemuImageUrl(env)).pathname));
}

export function defaultQemuPreparedImagePath(options = {}) {
  const imageUrl = options.imageUrl ?? process.env.AUTOMIFY_QEMU_DEFAULT_IMAGE_URL ?? defaultQemuImageUrl();
  const preparedDir = options.preparedDir ?? defaultQemuPreparedImageCacheRoot();
  const sourceName = basename(new URL(imageUrl).pathname).replace(/\.(qcow2|img|raw)$/i, "");
  const profile = options.profile ?? "base";
  const packages = uniquePackages(options.packages ?? []);
  const setupKey = options.setupKey ?? packages.join("\n");
  const key = createHash("sha256")
    .update([DEFAULT_QEMU_PREPARED_IMAGE_VERSION, imageUrl, process.arch, profile, setupKey].join("\n"))
    .digest("hex")
    .slice(0, 12);
  return join(preparedDir, `${sourceName}-${profile}-${key}.automify-prepared.qcow2`);
}

export async function prepareDefaultQemuImage(options = {}) {
  const execFile = options.execFile ?? execFileAsync;
  const cache = await ensureDefaultQemuImageCache(options);
  const backingImage = cache.preparedImage ?? cache.baseImage;
  const workDir = await mkdtemp(join(tmpdir(), "automify-qemu-debian-"));
  let cloudInitServer;
  let keyPath = cache.sshKeyPath;
  let extraQemuArgs = [...(cache.extraQemuArgs ?? [])];

  try {
    if (!cache.preparedImage) {
      keyPath = join(workDir, "id_ed25519");
      await execFile(options.sshKeygenCommand ?? "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]);
      const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim();
      const createCloudInitServer = options.createCloudInitServer ?? createNoCloudServer;
      cloudInitServer = await createCloudInitServer({
        publicKey,
        hostname: sanitizeHostname(options.vmName ?? `automify-${randomUUID()}`)
      });
      extraQemuArgs = ["-smbios", `type=1,serial=ds=nocloud-net;s=http://10.0.2.2:${cloudInitServer.port}/`];
    }

    const overlayPath = join(workDir, "disk.qcow2");
    await execFile(options.qemuImgCommand ?? "qemu-img", [
      "create",
      "-f",
      "qcow2",
      "-F",
      "qcow2",
      "-b",
      backingImage,
      overlayPath
    ]);

    return {
      image: overlayPath,
      diskFormat: "qcow2",
      sshUser: "automify",
      sshKeyPath: keyPath,
      sudo: true,
      extraQemuArgs,
      baseImage: cache.baseImage,
      preparedImage: cache.preparedImage,
      preparedPackages: cache.preparedPackages ?? [],
      imageUrl: cache.imageUrl,
      workDir,
      async close() {
        await cloudInitServer?.close();
        await rm(workDir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await cloudInitServer?.close();
    await rm(workDir, { recursive: true, force: true });
    throw error;
  }
}

export async function ensureDefaultQemuImageCache(options = {}) {
  const execFile = options.execFile ?? execFileAsync;
  const hasCustomFetch = typeof options.fetchImpl === "function";
  const fetchImpl = hasCustomFetch ? options.fetchImpl : globalThis.fetch;
  const imageUrl = options.imageUrl ?? process.env.AUTOMIFY_QEMU_DEFAULT_IMAGE_URL ?? defaultQemuImageUrl();
  const cacheOptions = normalizeDefaultImageCache(options.defaultImageCache, options);
  const baseImage = options.baseImage ?? join(cacheOptions.imageCacheDir, basename(new URL(imageUrl).pathname));

  await ensureDefaultQemuBaseImage(baseImage, imageUrl, {
    fetchImpl,
    forceDownload: cacheOptions.forceDownload,
    nativeDownloadFallback: !hasCustomFetch
  });

  if (!cacheOptions.prepared) {
    return {
      baseImage,
      preparedImage: null,
      preparedPackages: [],
      imageUrl
    };
  }

  const prepared = await ensurePreparedQemuImage({
    ...options,
    execFile,
    imageUrl,
    baseImage,
    preparedImage:
      options.preparedImage ??
      defaultQemuPreparedImagePath({
        imageUrl,
        preparedDir: cacheOptions.preparedDir,
        profile: options.preparedImageProfile,
        packages: options.preparedPackages,
        setupKey: options.preparedSetupKey
      }),
    keyPath: options.preparedSshKeyPath,
    packages: options.preparedPackages,
    setupCommands: options.preparedSetupCommands,
    forcePrepare: cacheOptions.forcePrepare || cacheOptions.forceDownload
  });

  return {
    baseImage,
    preparedImage: prepared.image,
    sshKeyPath: prepared.keyPath,
    preparedPackages: prepared.packages ?? [],
    imageUrl
  };
}

export function buildQemuArgs(options = {}) {
  if (!options.image && !options.existingVM) {
    throw new AutomifyError("QEMU virtual adapter requires image or vm.image with a bootable disk image.");
  }

  const args = [];
  appendNonEmptyArg(args, "-name", options.name);
  appendNonEmptyArg(args, "-m", options.memory ?? DEFAULT_QEMU_MEMORY);
  const cpus = positiveInteger(options.cpus) ?? DEFAULT_QEMU_CPUS;
  appendNonEmptyArg(args, "-smp", cpus);

  if (options.machine) {
    appendNonEmptyArg(args, "-machine", options.machine);
  } else if (process.arch === "arm64") {
    appendNonEmptyArg(args, "-machine", "virt");
  }

  appendNonEmptyArg(args, "-accel", options.accel ?? defaultQemuAccel());
  appendNonEmptyArg(args, "-cpu", options.cpu ?? defaultQemuCpu(options));
  appendNonEmptyArg(args, "-bios", options.firmware ?? defaultQemuFirmware());

  args.push("-display", "none", "-no-reboot");

  if (options.image) {
    args.push("-drive", `file=${options.image},if=virtio,format=${options.diskFormat ?? "qcow2"}`);
  }

  if (options.network !== false) {
    const netdev = [`user`, `id=net0`];
    if (options.sshPort) {
      netdev.push(`hostfwd=tcp:${options.sshHost ?? DEFAULT_QEMU_SSH_HOST}:${options.sshPort}-:22`);
    }
    args.push("-netdev", netdev.join(","));
    args.push("-device", options.networkDevice ?? "virtio-net-pci,netdev=net0");
  }

  if (options.sharedFolder && options.sharedMode !== "none") {
    args.push(
      "-virtfs",
      [
        "local",
        `path=${options.sharedFolder.hostPath}`,
        `mount_tag=${options.sharedTag ?? "automify_shared"}`,
        `security_model=${options.sharedSecurityModel ?? "none"}`
      ].join(",")
    );
  }

  for (const arg of options.extraQemuArgs ?? []) {
    args.push(String(arg));
  }

  return args;
}

export function sshArgs(options = {}, command) {
  const args = [
    "-p",
    String(options.sshPort),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null"
  ];

  for (const option of options.sshOptions ?? []) {
    args.push(String(option));
  }
  if (options.sshKeyPath) {
    args.push("-i", options.sshKeyPath);
  }

  args.push(`${options.sshUser ?? DEFAULT_QEMU_SSH_USER}@${options.sshHost ?? DEFAULT_QEMU_SSH_HOST}`);
  if (command != null) args.push(String(command));
  return args;
}

export async function waitForSsh(execFile, sshCommand, options = {}) {
  const timeoutMs = positiveInteger(options.startupTimeoutMs) ?? 60_000;
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await execFile(sshCommand, sshArgs(options, "true"), {
        timeout: positiveInteger(options.sshTimeoutMs) ?? 5_000
      });
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }

  throw lastError ?? new AutomifyError("QEMU SSH readiness check timed out.");
}

export async function stopQemuProcess(child, timeoutMs = 1500) {
  if (!child || child.killed) return;
  const exited = new Promise((resolve) => {
    child.once?.("exit", resolve);
    child.once?.("close", resolve);
  });
  child.kill?.("SIGTERM");
  await Promise.race([exited, sleep(timeoutMs)]);
  if (!child.killed) child.kill?.("SIGKILL");
}

export function installCommand(packages, options = {}) {
  if (options.installDependencies === false || packages.length === 0) return ":";
  const apt = [
    "export DEBIAN_FRONTEND=noninteractive",
    `${sudo(options)}apt-get update`,
    `${sudo(options)}apt-get install -y --no-install-recommends ${packages.map(shellQuote).join(" ")}`,
    `${sudo(options)}rm -rf /var/lib/apt/lists/*`
  ];
  return apt.join(" && ");
}

export function mountSharedFolderCommand(sharedFolder, options = {}) {
  if (!sharedFolder || options.sharedMode === "none") return ":";
  const target = normalizeGuestPath(sharedFolder.containerPath);
  const tag = options.sharedTag ?? "automify_shared";
  return [
    `${sudo(options)}mkdir -p ${shellQuote(target)}`,
    `${sudo(options)}mount -t 9p -o trans=virtio,version=9p2000.L ${shellQuote(tag)} ${shellQuote(target)} || true`
  ].join(" && ");
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function uniquePackages(packages) {
  return [...new Set(packages.map((pkg) => String(pkg).trim()).filter(Boolean))];
}

export function normalizeGuestPath(value, fallback = "/workspace") {
  const path = String(value || fallback).trim();
  return path.startsWith("/") ? path : `/${path}`;
}

export function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendNonEmptyArg(args, flag, value) {
  if (value == null || value === false || value === "") return;
  args.push(flag, String(value));
}

function sudo(options) {
  return options.sudo ? "sudo -n " : "";
}

async function ensureDefaultQemuBaseImage(path, url, options = {}) {
  try {
    const info = await stat(path);
    if (!options.forceDownload && info.size > 0) return;
  } catch {
    // The image is downloaded below.
  }

  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.download-${process.pid}-${Date.now()}`;
  try {
    await downloadFile(url, tempPath, options);
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw new AutomifyError(`Failed to download the default QEMU Debian image from ${url}.`, { cause: error });
  }
}

async function ensurePreparedQemuImage(options = {}) {
  const execFile = options.execFile ?? execFileAsync;
  const spawn = options.spawn;
  const qemu = options.qemuCommand ?? defaultQemuCommand();
  const qemuImg = options.qemuImgCommand ?? "qemu-img";
  const preparedImage = options.preparedImage;
  const keyPath = options.keyPath ?? `${preparedImage}.id_ed25519`;
  const packages = uniquePackages(options.packages ?? []);

  if (!options.forcePrepare && (await existingNonEmptyFile(preparedImage)) && (await existingNonEmptyFile(keyPath))) {
    return {
      image: preparedImage,
      keyPath,
      packages
    };
  }

  if (typeof spawn !== "function") {
    throw new AutomifyError("Preparing the default QEMU image requires a spawn implementation.");
  }

  await mkdir(dirname(preparedImage), { recursive: true });
  await rm(preparedImage, { force: true });
  await rm(keyPath, { force: true });
  await rm(`${keyPath}.pub`, { force: true });

  const workDir = await mkdtemp(join(tmpdir(), "automify-qemu-prepare-"));
  const tempImage = join(workDir, "prepared.qcow2");
  let child;
  let cloudInitServer;

  try {
    await execFile(qemuImg, ["create", "-f", "qcow2", "-F", "qcow2", "-b", options.baseImage, tempImage]);
    await execFile(options.sshKeygenCommand ?? "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]);
    const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim();
    const createCloudInitServer = options.createCloudInitServer ?? createNoCloudServer;
    cloudInitServer = await createCloudInitServer({
      publicKey,
      hostname: sanitizeHostname(options.vmName ?? `automify-prepared-${randomUUID()}`)
    });

    const sshPort = positiveInteger(options.sshPort) ?? (await getAvailablePort());
    const qemuArgs = buildQemuArgs({
      ...options,
      name: sanitizeHostname(`${options.vmName ?? "automify-prepared"}-cache`),
      image: tempImage,
      diskFormat: "qcow2",
      sshPort,
      extraQemuArgs: ["-smbios", `type=1,serial=ds=nocloud-net;s=http://10.0.2.2:${cloudInitServer.port}/`]
    });
    child = spawn(qemu, qemuArgs, { stdio: "ignore" });
    child.unref?.();
    const sshOptions = {
      ...options,
      sshPort,
      sshUser: "automify",
      sshKeyPath: keyPath,
      sudo: true
    };

    await waitForSsh(execFile, options.sshCommand ?? "ssh", sshOptions);
    await execFile(options.sshCommand ?? "ssh", sshArgs(sshOptions, preparedImageSetupCommand(options)), {
      timeout: positiveInteger(options.timeoutMs) ?? 60_000
    });
    await stopQemuProcess(child, positiveInteger(options.qemuTimeoutMs) ?? 1500);
    child = null;
    await rename(tempImage, preparedImage);

    return {
      image: preparedImage,
      keyPath,
      packages
    };
  } catch (error) {
    await stopQemuProcess(child, positiveInteger(options.qemuTimeoutMs) ?? 1500);
    await rm(preparedImage, { force: true });
    await rm(keyPath, { force: true });
    await rm(`${keyPath}.pub`, { force: true });
    throw new AutomifyError("Failed to prepare the cached default QEMU Debian image.", { cause: error });
  } finally {
    await cloudInitServer?.close();
    await rm(workDir, { recursive: true, force: true });
  }
}

async function existingNonEmptyFile(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

function normalizeDefaultImageCache(value, options = {}) {
  const imageCacheDir =
    options.cacheDir ?? options.imageCacheDir ?? options.qemuImageCacheDir ?? defaultQemuImageCacheRoot();
  const preparedDir = options.preparedImageCacheDir ?? join(imageCacheDir, "prepared");
  if (value === false) {
    return {
      imageCacheDir,
      preparedDir,
      prepared: false,
      forceDownload: false,
      forcePrepare: false
    };
  }
  if (value == null || value === true) {
    return {
      imageCacheDir,
      preparedDir,
      prepared: true,
      forceDownload: false,
      forcePrepare: false
    };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AutomifyError("defaultImageCache must be a boolean or an object.");
  }
  const dir = value.dir ? resolve(value.dir) : imageCacheDir;
  const normalized = {
    imageCacheDir: value.imageCacheDir ? resolve(value.imageCacheDir) : dir,
    preparedDir: value.preparedDir ? resolve(value.preparedDir) : join(dir, "prepared"),
    prepared: value.prepared !== false,
    forceDownload: value.forceDownload === true,
    forcePrepare: value.forcePrepare === true
  };
  if (normalized.forceDownload) normalized.forcePrepare = true;
  return normalized;
}

function preparedImageSetupCommand(options = {}) {
  const packages = uniquePackages(options.packages ?? []);
  const setupCommands = [installCommand(packages, { sudo: true }), ...(options.setupCommands ?? [])].filter(
    (command) => command && command !== ":"
  );
  return [
    "set -eu",
    ...setupCommands,
    "sudo -n install -d -m 700 -o automify -g automify /home/automify/.ssh",
    "sudo -n touch /etc/cloud/cloud-init.disabled || true",
    "sudo -n cloud-init clean --logs || true",
    "sudo -n rm -f /var/lib/cloud/instance /var/lib/cloud/data/result.json || true",
    "sudo -n sync"
  ].join(" && ");
}

async function downloadFile(url, targetPath, options = {}) {
  const fetchImpl = options.fetchImpl;
  if (typeof fetchImpl !== "function") {
    throw new AutomifyError("Default QEMU Debian image download requires a fetch implementation.");
  }

  try {
    await downloadFileWithFetch(fetchImpl, url, targetPath);
    return;
  } catch (error) {
    if (!options.nativeDownloadFallback) throw error;
    try {
      await downloadFileWithHttp(url, targetPath, {
        family: 4,
        timeoutMs: options.downloadTimeoutMs
      });
      return;
    } catch (fallbackError) {
      throw new AutomifyError("Default QEMU Debian image download failed with fetch and IPv4 fallback.", {
        cause: fallbackError
      });
    }
  }
}

async function downloadFileWithFetch(fetchImpl, url, targetPath) {
  const response = await fetchImpl(url);
  if (!response?.ok) {
    throw new AutomifyError(`Default QEMU Debian image download failed with HTTP ${response?.status ?? "error"}.`);
  }
  if (!response.body) {
    throw new AutomifyError("Default QEMU Debian image download returned an empty response body.");
  }

  const body = typeof response.body.getReader === "function" ? Readable.fromWeb(response.body) : response.body;
  await pipeline(body, createWriteStream(targetPath));
}

async function downloadFileWithHttp(url, targetPath, options = {}, redirectCount = 0) {
  if (redirectCount > MAX_QEMU_IMAGE_DOWNLOAD_REDIRECTS) {
    throw new AutomifyError("Default QEMU Debian image download followed too many redirects.");
  }

  const parsed = new URL(url);
  const get = parsed.protocol === "https:" ? httpsGet : parsed.protocol === "http:" ? httpGet : null;
  if (!get) {
    throw new AutomifyError(`Default QEMU Debian image download does not support ${parsed.protocol} URLs.`);
  }

  await new Promise((resolve, reject) => {
    const request = get(
      parsed,
      {
        family: options.family,
        timeout: positiveInteger(options.timeoutMs) ?? DEFAULT_QEMU_IMAGE_DOWNLOAD_TIMEOUT_MS,
        headers: {
          "user-agent": "automify/qemu-image"
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          resolve(downloadFileWithHttp(new URL(location, parsed).href, targetPath, options, redirectCount + 1));
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new AutomifyError(`Default QEMU Debian image download failed with HTTP ${statusCode || "error"}.`));
          return;
        }

        pipeline(response, createWriteStream(targetPath)).then(resolve, reject);
      }
    );
    request.on("error", reject);
    request.setTimeout(positiveInteger(options.timeoutMs) ?? DEFAULT_QEMU_IMAGE_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new AutomifyError("Default QEMU Debian image download timed out."));
    });
  });
}

async function createNoCloudServer(options = {}) {
  const userData = [
    "#cloud-config",
    "users:",
    "  - default",
    "  - name: automify",
    "    groups: sudo",
    "    shell: /bin/bash",
    "    sudo: ALL=(ALL) NOPASSWD:ALL",
    "    ssh_authorized_keys:",
    `      - ${options.publicKey}`,
    "ssh_pwauth: false",
    "disable_root: false",
    "package_update: false",
    ""
  ].join("\n");
  const metaData = [
    `instance-id: automify-${randomUUID()}`,
    `local-hostname: ${sanitizeHostname(options.hostname ?? "automify-qemu")}`,
    ""
  ].join("\n");

  const routes = new Map([
    ["/user-data", userData],
    ["/meta-data", metaData],
    ["/vendor-data", ""],
    ["/network-config", ""]
  ]);

  const server = createHttpServer((request, response) => {
    const path = request.url?.split("?")[0] ?? "/";
    if (!routes.has(path)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(routes.get(path));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref?.();

  return {
    port: server.address().port,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

function debianCloudImageArch() {
  switch (process.arch) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      throw new AutomifyError(`Default QEMU Debian image is not available for Node architecture ${process.arch}.`);
  }
}

function sanitizeHostname(value) {
  const normalized = String(value ?? "automify-qemu")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return normalized || "automify-qemu";
}
