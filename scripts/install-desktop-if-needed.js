#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  desktopRuntimeDir,
  desktopRuntimeIsInstalled,
  desktopRuntimeKey,
  findDesktopRuntimeManifests
} from "../src/lib/desktop-runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

if (process.env.AUTOMIFY_SKIP_DESKTOP_INSTALL === "1" || process.env.AUTOMIFY_SKIP_DESKTOP_AUTO_REBUILD === "1") {
  process.exit(0);
}

if (desktopRuntimeIsInstalled()) {
  process.exit(0);
}

const existingManifests = findDesktopRuntimeManifests();
const legacyNodeModulesRuntime = existsSync(join(root, "node_modules", "@nut-tree", "nut-js", "package.json"));

if (existingManifests.length === 0 && !legacyNodeModulesRuntime) {
  process.exit(0);
}

console.log("Automify desktop runtime was previously installed but is not compatible with this environment.");
console.log(`Rebuilding desktop runtime cache: ${desktopRuntimeKey()}`);
console.log(`Runtime directory: ${desktopRuntimeDir()}`);

const result = spawnSync(process.execPath, [join(__dirname, "install-desktop.js")], {
  cwd: root,
  env: process.env,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
