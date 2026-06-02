#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_RUNTIME_MANIFEST,
  desktopRuntimeDir,
  desktopRuntimeKey,
  desktopRuntimeManifest,
  desktopRuntimeNodeModules,
  desktopRuntimeRefs
} from "../src/lib/desktop-runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const buildRoot = process.env.AUTOMIFY_DESKTOP_BUILD_DIR
  ? resolve(process.env.AUTOMIFY_DESKTOP_BUILD_DIR)
  : join(root, ".automify-desktop");
const nutSource = join(buildRoot, "nut.js");
const libnutSource = join(buildRoot, "libnut-core");
const macPermissionsSource = join(buildRoot, "node-mac-permissions");
const refs = desktopRuntimeRefs();
const runtimeDir = desktopRuntimeDir();
const runtimeNodeModules = desktopRuntimeNodeModules();
const nodeModules = runtimeNodeModules;
const nutScope = join(nodeModules, "@nut-tree");
const platformPackageName = `@nut-tree/libnut-${process.platform}`;
const platformPackageDir = join(nutScope, `libnut-${process.platform}`);
const macPermissionsPackageDir = join(nutScope, "node-mac-permissions");

const runtimeDependencies = ["jimp@1.6.1", "node-abort-controller@3.1.1", "clipboardy@2.3.0", "bindings@1.5.0"];

console.log("Building official nut.js from source.");
console.log(`Build directory: ${buildRoot}`);
console.log(`Runtime directory: ${runtimeDir}`);
console.log(`Runtime key: ${desktopRuntimeKey()}`);
console.log(`nut.js ref: ${refs.nut}`);
console.log(`libnut-core ref: ${refs.libnutCore}`);
if (process.platform === "darwin") {
  console.log(`node-mac-permissions ref: ${refs.macPermissions}`);
}

checkBuildPrerequisites();

mkdirSync(buildRoot, { recursive: true });
mkdirSync(runtimeDir, { recursive: true });
writeRuntimePackageJson();
cloneOrPull("https://github.com/nut-tree/libnut-core.git", libnutSource, refs.libnutCore);
cloneOrPull("https://github.com/nut-tree/nut.js.git", nutSource, refs.nut);
if (process.platform === "darwin") {
  cloneOrPull("https://github.com/nut-tree/node-mac-permissions.git", macPermissionsSource, refs.macPermissions);
}

patchNutWorkspace();

run("npm", ["install"], { cwd: libnutSource });
buildLibnutCore();

run("node", ["patch-packagename.js"], {
  cwd: libnutSource,
  env: { ...process.env, CI: "1" }
});

if (process.platform === "darwin") {
  run("npm", ["install"], { cwd: macPermissionsSource });
  run("npm", ["run", "build:release"], { cwd: macPermissionsSource });
}

patchPlatformLibnutDependency();

runPnpm(["install"], { cwd: nutSource });
runPnpm(["--filter", "@nut-tree/shared", "run", "compile"], { cwd: nutSource });
patchNutJimpCompatibility();
runPnpm(["--filter", "@nut-tree/provider-interfaces", "run", "compile"], { cwd: nutSource });
runPnpm(["--filter", "@nut-tree/default-clipboard-provider", "run", "compile"], { cwd: nutSource });
runPnpm(["--filter", "@nut-tree/libnut", "run", "compile"], { cwd: nutSource });
writeLibnutImportBridge();
runPnpm(["--filter", "@nut-tree/nut-js", "run", "compile"], { cwd: nutSource });
patchNutJimpCompatibility();

run("npm", ["install", "--no-save", ...runtimeDependencies], { cwd: runtimeDir });

installWorkspacePackage(join(nutSource, "core", "shared"), join(nutScope, "shared"));
installWorkspacePackage(join(nutSource, "core", "provider-interfaces"), join(nutScope, "provider-interfaces"));
installWorkspacePackage(join(nutSource, "providers", "clipboardy"), join(nutScope, "default-clipboard-provider"));
installWorkspacePackage(join(nutSource, "providers", "libnut"), join(nutScope, "libnut"));
installWorkspacePackage(join(nutSource, "core", "nut.js"), join(nutScope, "nut-js"));
installWorkspacePackage(libnutSource, platformPackageDir);
if (process.platform === "darwin") {
  installWorkspacePackage(macPermissionsSource, macPermissionsPackageDir);
}

writeRuntimeManifest();
run(
  "node",
  [
    "-e",
    `const { createRequire } = require("node:module");
const { join } = require("node:path");
const runtimeDir = process.argv[1];
createRequire(join(runtimeDir, "automify-desktop-runtime.cjs"))("@nut-tree/nut-js");
console.log("nut.js source build import ok");`,
    runtimeDir
  ],
  { cwd: root }
);

function cloneOrPull(repo, target, ref) {
  if (existsSync(join(target, ".git"))) {
    run("git", ["-C", target, "fetch", "--depth", "1", "origin", ref]);
    checkoutFetchedRef(target, ref);
    run("git", ["-C", target, "clean", "-fd"]);
    return;
  }

  rmSync(target, { recursive: true, force: true });
  run("git", ["clone", "--depth", "1", "--branch", ref, repo, target], { exitOnError: false }).ok ||
    run("git", ["clone", "--depth", "1", repo, target]);
  if (!currentRefMatches(target, ref)) {
    run("git", ["-C", target, "fetch", "--depth", "1", "origin", ref]);
    checkoutFetchedRef(target, ref);
  }
}

function checkoutFetchedRef(target, ref) {
  run("git", ["-C", target, "checkout", "--detach", "FETCH_HEAD"]);
}

function currentRefMatches(target, ref) {
  const result = spawnSync("git", ["-C", target, "rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: root,
    encoding: "utf8"
  });
  return (result.status ?? 1) === 0;
}

function checkBuildPrerequisites() {
  const missing = [];

  for (const command of ["git", "npm", "cmake"]) {
    if (!commandExists(command)) missing.push(command);
  }
  if (process.platform === "win32" && !windowsBuildToolsExist()) {
    missing.push("Visual Studio 2022 C++ Build Tools");
  }

  if (missing.length === 0) return;

  console.error(`Missing required desktop build tool(s): ${missing.join(", ")}`);
  console.error("Install the native build prerequisites, then rerun: npx automify-install-desktop");

  if (process.platform === "darwin") {
    console.error("macOS: install Xcode Command Line Tools with `xcode-select --install` and install CMake.");
  } else if (process.platform === "linux") {
    console.error("Linux: install git, build-essential, cmake, pkg-config, libx11-dev, libxtst-dev, and libpng++-dev.");
    console.error("The Linux installer does not verify every native library package before building.");
  } else if (process.platform === "win32") {
    console.error("Windows: install CMake and Visual Studio 2022 C++ Build Tools.");
    console.error("Make sure the `Desktop development with C++` workload is installed.");
  }

  process.exit(1);
}

function commandExists(command) {
  return resolveCommand(command) !== null;
}

function resolveCommand(command) {
  for (const candidate of commandCandidates(command)) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
      cwd: root,
      stdio: "ignore"
    });
    if ((result.status ?? 1) === 0) return candidate;
  }
  return null;
}

function commandCandidates(command) {
  const candidates = [];

  const npmCli = npmCliCandidate(command);
  if (npmCli) candidates.push(npmCli);

  if (process.platform === "win32" && ["npm", "npx"].includes(command)) {
    candidates.push({ command: `${command}.cmd`, args: [] });
  }

  candidates.push({ command, args: [] });
  return candidates;
}

function npmCliCandidate(command) {
  if (!["npm", "npx"].includes(command)) return null;

  const npmExecPath =
    process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmExecPath)) return null;
  if (command === "npm") return { command: process.execPath, args: [npmExecPath] };

  const npxExecPath = join(dirname(npmExecPath), "npx-cli.js");
  if (!existsSync(npxExecPath)) return null;
  return { command: process.execPath, args: [npxExecPath] };
}

function runResolvedCommand(command, args, options = {}) {
  const candidate = resolveCommand(command) ?? { command, args: [] };
  return spawnSync(candidate.command, [...candidate.args, ...args], {
    cwd: root,
    ...options
  });
}

function windowsBuildToolsExist() {
  const vswhere = join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );
  if (!existsSync(vswhere)) return false;

  const result = spawnSync(
    vswhere,
    [
      "-products",
      "*",
      "-version",
      "[17.0,18.0)",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath"
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe"
    }
  );
  return (result.status ?? 1) === 0 && result.stdout.trim().length > 0;
}

function patchPlatformLibnutDependency() {
  const packagePath = join(nutSource, "providers", "libnut", "package.json");
  const packageJson = JSON.parse(readText(packagePath));
  packageJson.dependencies = {
    [platformPackageName]: `file:${libnutSource}`
  };
  writeText(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function buildLibnutCore() {
  const build = run("npm", ["run", "build:release"], {
    cwd: libnutSource,
    exitOnError: false
  });

  if (build.ok) return;

  if (!shouldPatchMacosSdk15Build(build)) {
    process.exit(build.status ?? 1);
  }

  console.warn("libnut-core failed against the macOS SDK 15 screen-capture availability check.");
  console.warn("Applying local compatibility patch for CGDisplayCreateImageForRect and retrying.");
  patchLibnutCoreForMacosSdk15();
  run("npm", ["run", "build:release"], { cwd: libnutSource });
}

function shouldPatchMacosSdk15Build(result) {
  if (process.platform !== "darwin") return false;
  if (process.env.AUTOMIFY_DESKTOP_DISABLE_MACOS_SDK15_PATCH === "1") return false;
  return `${result.stdout}\n${result.stderr}`.includes("CGDisplayCreateImageForRect");
}

function patchLibnutCoreForMacosSdk15() {
  if (process.platform !== "darwin") return;

  const screenGrabPath = join(libnutSource, "src", "macos", "screengrab.m");
  let source = readText(screenGrabPath);

  if (source.includes("AutomifyCGDisplayCreateImageForRect")) return;

  source = source.replace(
    "#import <Cocoa/Cocoa.h>",
    `#import <Cocoa/Cocoa.h>
#include <dlfcn.h>

typedef CGImageRef (*AutomifyCGDisplayCreateImageForRectFn)(CGDirectDisplayID, CGRect);

static CGImageRef AutomifyCGDisplayCreateImageForRect(CGDirectDisplayID displayID, CGRect rect) {
    AutomifyCGDisplayCreateImageForRectFn fn = (AutomifyCGDisplayCreateImageForRectFn)dlsym(RTLD_DEFAULT, "CGDisplayCreateImageForRect");
    if (!fn) { return NULL; }
    return fn(displayID, rect);
}`
  );
  source = source.replace("CGDisplayCreateImageForRect(displayID,", "AutomifyCGDisplayCreateImageForRect(displayID,");

  writeText(screenGrabPath, source);
}

function patchNutWorkspace() {
  writeText(
    join(nutSource, "pnpm-workspace.yaml"),
    `packages:
  - 'core/*'
  - 'providers/libnut'
  - 'providers/clipboardy'
`
  );

  for (const relativePath of [
    ["providers", "clipboardy", "package.json"],
    ["providers", "libnut", "package.json"]
  ]) {
    const packagePath = join(nutSource, ...relativePath);
    const packageJson = JSON.parse(readText(packagePath));
    delete packageJson.peerDependencies;
    writeText(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
}

function writeLibnutImportBridge() {
  const distDir = join(nutSource, "providers", "libnut", "dist");
  mkdirSync(distDir, { recursive: true });
  writeText(
    join(distDir, "import_libnut.js"),
    `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.libnut = void 0;
exports.libnut = process.platform === "win32"
  ? require("@nut-tree/libnut-win32")
  : process.platform === "linux"
    ? require("@nut-tree/libnut-linux")
    : require("@nut-tree/libnut-darwin");
`
  );
  writeText(
    join(distDir, "import_libnut.d.ts"),
    `import ln from "./libnut";
declare const libnut: typeof ln;
export { libnut };
`
  );
}

function patchNutJimpCompatibility() {
  const sharedImageToJimpPath = join(
    nutSource,
    "core",
    "shared",
    "dist",
    "lib",
    "functions",
    "imageToJimp.function.js"
  );
  if (existsSync(sharedImageToJimpPath)) {
    writeText(
      sharedImageToJimpPath,
      `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageToJimp = void 0;
const jimp_1 = require("jimp");
const colormode_enum_1 = require("../enums/colormode.enum");
function imageToJimp(image) {
    const jimpImage = new jimp_1.Jimp({
        data: image.data,
        width: image.width,
        height: image.height
    });
    if (image.colorMode === colormode_enum_1.ColorMode.BGR) {
        jimpImage.scan(0, 0, jimpImage.bitmap.width, jimpImage.bitmap.height, function (_, __, idx) {
            const red = this.bitmap.data[idx];
            this.bitmap.data[idx] = this.bitmap.data[idx + 2];
            this.bitmap.data[idx + 2] = red;
        });
    }
    return jimpImage;
}
exports.imageToJimp = imageToJimp;
`
    );
  }

  const jimpImageWriterPath = join(
    nutSource,
    "core",
    "nut.js",
    "dist",
    "lib",
    "provider",
    "io",
    "jimp-image-writer.class.js"
  );
  if (existsSync(jimpImageWriterPath)) {
    writeText(
      jimpImageWriterPath,
      `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const shared_1 = require("@nut-tree/shared");
class default_1 {
    store(parameters) {
        return new Promise((resolve, reject) => {
            const jimpImage = (0, shared_1.imageToJimp)(parameters.image);
            jimpImage
                .write(parameters.path)
                .then((_) => resolve())
                .catch((err) => reject(err));
        });
    }
}
exports.default = default_1;
`
    );
  }
}

function installWorkspacePackage(source, target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  const excludedDirs = [join(source, "node_modules"), join(source, "coverage")];
  cpSync(source, target, {
    recursive: true,
    filter: (file) =>
      !excludedDirs.some((excludedDir) => file === excludedDir || file.startsWith(`${excludedDir}${sep}`))
  });
}

function writeRuntimePackageJson() {
  writeText(
    join(runtimeDir, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        name: "automify-desktop-runtime",
        description: "Persistent native runtime cache for Automify local desktop support."
      },
      null,
      2
    )}\n`
  );
}

function writeRuntimeManifest() {
  writeText(
    join(runtimeDir, DESKTOP_RUNTIME_MANIFEST),
    `${JSON.stringify(
      {
        ...desktopRuntimeManifest(),
        createdAt: new Date().toISOString()
      },
      null,
      2
    )}\n`
  );
}

function run(command, args, options = {}) {
  const result = runResolvedCommand(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    shell: false,
    stdio: options.exitOnError === false ? "pipe" : "inherit",
    encoding: options.exitOnError === false ? "utf8" : undefined
  });
  const commandResult = {
    ok: (result.status ?? 1) === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error
  };

  if (!commandResult.ok) {
    if (options.exitOnError === false) {
      if (commandResult.stdout) process.stdout.write(commandResult.stdout);
      if (commandResult.stderr) process.stderr.write(commandResult.stderr);
      return commandResult;
    }
    if (options.allowMissing && result.error?.code === "ENOENT") return;
    process.exit(commandResult.status);
  }

  if (options.exitOnError === false) {
    if (commandResult.stdout) process.stdout.write(commandResult.stdout);
    if (commandResult.stderr) process.stderr.write(commandResult.stderr);
  }

  return commandResult;
}

function runPnpm(args, options = {}) {
  run("npx", ["--yes", "pnpm@8.15.2", ...args], options);
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function writeText(path, text) {
  writeFileSync(path, text);
}
