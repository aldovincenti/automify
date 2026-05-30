import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { AutomifyError } from "./errors.js";

const LOCK_ROOT = join(tmpdir(), "automify-locks");

export async function acquireAdapterLock(resource, options = {}) {
  if (!resource) return null;

  const label = options.label ?? resource;
  const token = randomUUID();
  const lockDir = adapterLockPath(resource);
  const owner = {
    pid: process.pid,
    resource,
    label,
    token,
    hostname: safeHostname(),
    createdAt: new Date().toISOString()
  };

  await mkdir(LOCK_ROOT, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDir);
      await writeFile(join(lockDir, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`);
      return async () => {
        await releaseAdapterLock(lockDir, token);
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!(await removeStaleLock(lockDir))) {
        throw new AutomifyError(adapterLockErrorMessage(label, lockDir, await readLockOwner(lockDir)));
      }
    }
  }

  throw new AutomifyError(adapterLockErrorMessage(label, lockDir, await readLockOwner(lockDir)));
}

function adapterLockPath(resource) {
  const digest = createHash("sha256").update(String(resource)).digest("hex").slice(0, 24);
  return join(LOCK_ROOT, digest);
}

async function releaseAdapterLock(lockDir, token) {
  const owner = await readLockOwner(lockDir);
  if (owner?.token !== token) return;
  await rm(lockDir, { recursive: true, force: true });
}

async function removeStaleLock(lockDir) {
  const owner = await readLockOwner(lockDir);
  if (!owner || isPidAlive(owner.pid)) return false;
  await rm(lockDir, { recursive: true, force: true });
  return true;
}

async function readLockOwner(lockDir) {
  try {
    return JSON.parse(await readFile(join(lockDir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  const normalized = Number(pid);
  if (!Number.isInteger(normalized) || normalized <= 0) return false;
  try {
    process.kill(normalized, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function adapterLockErrorMessage(label, lockDir, owner) {
  const details = owner?.pid ? `pid ${owner.pid}` : "an unknown process";
  return `${label} is already in use by ${details}. Close the existing adapter before creating another one, or remove stale lock ${lockDir}.`;
}

function safeHostname() {
  try {
    return hostname();
  } catch {
    return undefined;
  }
}
