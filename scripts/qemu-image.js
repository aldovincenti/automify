#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_QEMU_DESKTOP_PACKAGES } from "../src/lib/qemu-desktop-computer.js";
import { ensureDefaultQemuImageCache } from "../src/lib/qemu-runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const options = parseArgs(args);

console.log("Preparing Automify QEMU default Debian image cache.");
if (options.desktop) {
  console.log("Desktop cache enabled: the prepared image will include the default QEMU desktop packages.");
} else if (options.packages.length > 0) {
  console.log("CLI cache enabled: the prepared image will include the requested apt packages.");
} else {
  console.log("CLI cache enabled: the prepared image will stay minimal for QEMU virtual CLI runs.");
}
if (options.defaultImageCache.forceDownload) {
  console.log("Force download enabled: the cached base image will be replaced.");
}
if (options.defaultImageCache.forcePrepare) {
  console.log("Force prepare enabled: the cached prepared image will be rebuilt.");
}
if (options.defaultImageCache.prepared === false) {
  console.log("Prepared image disabled: only the base Debian qcow2 will be downloaded.");
}

try {
  const cache = await ensureDefaultQemuImageCache({
    qemuCommand: options.qemuCommand,
    qemuImgCommand: options.qemuImgCommand,
    imageUrl: options.imageUrl,
    defaultImageCache: options.defaultImageCache,
    preparedImageProfile: options.desktop ? "desktop" : undefined,
    preparedPackages: options.desktop ? uniquePackages([...DEFAULT_QEMU_DESKTOP_PACKAGES, ...options.packages]) : options.packages,
    spawn,
    vmName: "automify-qemu-image"
  });

  console.log(`Base image: ${cache.baseImage}`);
  if (cache.preparedImage) {
    console.log(`Prepared image: ${cache.preparedImage}`);
    console.log(`SSH key: ${cache.sshKeyPath}`);
  }
  console.log("Automify QEMU image cache is ready.");
} catch (error) {
  printError(error);
  process.exit(1);
}

function printError(error, depth = 0) {
  const prefix = depth === 0 ? "" : "Caused by: ";
  console.error(`${prefix}${error?.stack || error?.message || String(error)}`);
  for (const key of ["code", "signal", "killed"]) {
    if (error?.[key] != null) console.error(`${prefix}${key}: ${error[key]}`);
  }
  for (const key of ["stdout", "stderr"]) {
    if (error?.[key]) console.error(`${prefix}${key}:\n${String(error[key])}`);
  }
  if (error?.cause) printError(error.cause, depth + 1);
}

function parseArgs(argv) {
  const result = {
    defaultImageCache: {},
    desktop: false,
    packages: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--force":
      case "--force-download":
        result.defaultImageCache.forceDownload = true;
        result.defaultImageCache.forcePrepare = true;
        break;
      case "--force-prepare":
        result.defaultImageCache.forcePrepare = true;
        break;
      case "--no-prepare":
        result.defaultImageCache.prepared = false;
        break;
      case "--desktop":
        result.desktop = true;
        break;
      case "--package":
        result.packages.push(requiredValue(argv, ++index, arg));
        break;
      case "--cache-dir":
        result.defaultImageCache.dir = requiredValue(argv, ++index, arg);
        break;
      case "--prepared-cache-dir":
        result.defaultImageCache.preparedDir = requiredValue(argv, ++index, arg);
        break;
      case "--image-url":
        result.imageUrl = requiredValue(argv, ++index, arg);
        break;
      case "--qemu":
      case "--qemu-command":
        result.qemuCommand = requiredValue(argv, ++index, arg);
        break;
      case "--qemu-img":
      case "--qemu-img-command":
        result.qemuImgCommand = requiredValue(argv, ++index, arg);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return result;
}

function uniquePackages(packages) {
  return [...new Set(packages.map((pkg) => String(pkg).trim()).filter(Boolean))];
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    console.error(`${flag} requires a value.`);
    process.exit(1);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: npx automify-qemu-image [options]

Prepare or refresh the default Debian image cache used by Automify QEMU adapters.
Without --desktop, this pre-warms the minimal QEMU virtual CLI cache.

Options:
  --force-download        Re-download the base Debian qcow2 and rebuild prepared image
  --force-prepare         Rebuild only the prepared image
  --no-prepare            Download only the base Debian qcow2
  --desktop               Prepare the QEMU desktop cache variant
  --package <name>        Add an apt package to the prepared cache
  --cache-dir <path>      Cache root for base and prepared images
  --prepared-cache-dir <path>
                          Cache directory for prepared images
  --image-url <url>       Override the default Debian qcow2 URL
  --qemu <command>        Override qemu-system command
  --qemu-img <command>    Override qemu-img command
  --help                  Show this help

Examples:
  npx automify-qemu-image            # pre-warm the QEMU CLI cache
  npx automify-qemu-image --package coreutils --package nodejs
  npx automify-qemu-image --desktop  # pre-warm the QEMU desktop cache
  npx automify-qemu-image --force-download
  npx automify-qemu-image --cache-dir ${root}/.automify-qemu-cache
  npx automify-qemu-image --image-url https://example.com/path/linux.qcow2 --cache-dir ${root}/.automify-qemu-custom
`);
}
