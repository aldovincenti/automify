import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import { AutomifyError } from "./errors.js";

const DEFAULT_CONTAINER_PATH = "/workspace";

export async function prepareVirtualSharedFolder(options = {}, defaults = {}) {
  const sharedFiles = options.sharedFiles ?? options.files;
  const requested = options.sharedFolder ?? options.shared ?? (sharedFiles?.length ? true : null);
  if (!requested) return null;

  const config = normalizeSharedFolder(requested);
  const containerPath = normalizeContainerPath(
    config.containerPath ?? defaults.containerPath ?? DEFAULT_CONTAINER_PATH
  );
  const hostPath = config.hostPath
    ? resolve(config.hostPath)
    : await mkdtemp(join(tmpdir(), defaults.prefix ?? "automify-shared-"));
  const cleanup = !config.hostPath && config.cleanup !== false && options.keepContainer !== true;

  await mkdir(hostPath, { recursive: true });

  const copiedFiles = [];
  const files = [
    ...(Array.isArray(config.files) ? config.files : []),
    ...(Array.isArray(sharedFiles) ? sharedFiles : [])
  ];
  for (const file of files) {
    copiedFiles.push(await copySharedFile(file, hostPath, containerPath));
  }

  const readOnly = config.readOnly === true;
  return {
    hostPath,
    containerPath,
    readOnly,
    volume: `${hostPath}:${containerPath}${readOnly ? ":ro" : ":rw"}`,
    files: copiedFiles,
    data: {
      hostPath,
      containerPath,
      files: copiedFiles.map(({ sourcePath, ...file }) => file)
    },
    async close() {
      if (cleanup) {
        await rm(hostPath, { recursive: true, force: true });
      }
    }
  };
}

function normalizeSharedFolder(value) {
  if (value === true) return {};
  if (typeof value === "string") return { hostPath: value };
  if (value && typeof value === "object") {
    return {
      ...value,
      hostPath: value.hostPath ?? value.path
    };
  }
  throw new AutomifyError("sharedFolder must be true, a host path, or a shared folder options object.");
}

async function copySharedFile(file, hostPath, containerPath) {
  const descriptor = normalizeFile(file);
  const sourcePath = resolve(descriptor.path);
  const info = await stat(sourcePath);
  if (!info.isFile()) {
    throw new AutomifyError(`sharedFolder files must be regular files: ${sourcePath}`);
  }

  const targetPath = normalizeRelativeTarget(descriptor.targetPath ?? descriptor.name ?? basename(sourcePath));
  const destinationPath = join(hostPath, targetPath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);

  return {
    name: basename(targetPath),
    relativePath: targetPath,
    hostPath: destinationPath,
    containerPath: joinContainerPath(containerPath, targetPath),
    sourcePath,
    size: info.size
  };
}

function normalizeFile(file) {
  if (typeof file === "string") return { path: file };
  if (file && typeof file === "object" && typeof file.path === "string") return file;
  throw new AutomifyError("sharedFolder files must be paths or objects with a path.");
}

function normalizeRelativeTarget(value) {
  const raw = String(value || "").replaceAll("\\", "/");
  const normalized = relative("/", `/${raw}`);
  if (!normalized || normalized.startsWith("..")) {
    throw new AutomifyError(`Invalid shared file target path: ${value}`);
  }
  return normalized;
}

function normalizeContainerPath(value) {
  const path = String(value || DEFAULT_CONTAINER_PATH).trim();
  return path.startsWith("/") ? path : `/${path}`;
}

function joinContainerPath(base, target) {
  return `${base.replace(/\/+$/, "")}/${target.replace(/^\/+/, "")}`;
}
