import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const buildRoot = process.env.AUTOMIFY_DESKTOP_BUILD_DIR
  ? resolve(process.env.AUTOMIFY_DESKTOP_BUILD_DIR)
  : join(root, ".automify-desktop");
const nutSource = join(buildRoot, "nut.js");
const libnutSource = join(buildRoot, "libnut-core");
const macPermissionsSource = join(buildRoot, "node-mac-permissions");
const refs = {
  nut: process.env.AUTOMIFY_DESKTOP_NUT_REF ?? "e413fa1f19a19c4631812e4e1eaf47aa732b5cbe",
  libnutCore: process.env.AUTOMIFY_DESKTOP_LIBNUT_CORE_REF ?? "6bbe5825f1123bcd740117ca932c8b1c6cffb48c",
  macPermissions: process.env.AUTOMIFY_DESKTOP_MAC_PERMISSIONS_REF ?? "6b6ddee993ddce5071b637e42f6ee1434150d0bb"
};
const nodeModules = join(root, "node_modules");
const nutScope = join(nodeModules, "@nut-tree");
const platformPackageName = `@nut-tree/libnut-${process.platform}`;
const platformPackageDir = join(nutScope, `libnut-${process.platform}`);
const macPermissionsPackageDir = join(nutScope, "node-mac-permissions");

const runtimeDependencies = [
  "jimp@0.22.10",
  "node-abort-controller@3.1.1",
  "clipboardy@2.3.0",
  "bindings@1.5.0"
];

console.log("Building official nut.js from source.");
console.log(`Build directory: ${buildRoot}`);
console.log(`nut.js ref: ${refs.nut}`);
console.log(`libnut-core ref: ${refs.libnutCore}`);
if (process.platform === "darwin") {
  console.log(`node-mac-permissions ref: ${refs.macPermissions}`);
}

checkBuildPrerequisites();

mkdirSync(buildRoot, { recursive: true });
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
runPnpm(["--filter", "@nut-tree/provider-interfaces", "run", "compile"], { cwd: nutSource });
runPnpm(["--filter", "@nut-tree/default-clipboard-provider", "run", "compile"], { cwd: nutSource });
runPnpm(["--filter", "@nut-tree/libnut", "run", "compile"], { cwd: nutSource });
runPnpm(["--filter", "@nut-tree/nut-js", "run", "compile"], { cwd: nutSource });

run("npm", ["install", "--no-save", ...runtimeDependencies], { cwd: root });

installWorkspacePackage(join(nutSource, "core", "shared"), join(nutScope, "shared"));
installWorkspacePackage(join(nutSource, "core", "provider-interfaces"), join(nutScope, "provider-interfaces"));
installWorkspacePackage(join(nutSource, "providers", "clipboardy"), join(nutScope, "default-clipboard-provider"));
installWorkspacePackage(join(nutSource, "providers", "libnut"), join(nutScope, "libnut"));
installWorkspacePackage(join(nutSource, "core", "nut.js"), join(nutScope, "nut-js"));
installWorkspacePackage(libnutSource, platformPackageDir);
if (process.platform === "darwin") {
  installWorkspacePackage(macPermissionsSource, macPermissionsPackageDir);
}

run("node", ["-e", "import('@nut-tree/nut-js').then(() => console.log('nut.js source build import ok'))"], { cwd: root });

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

  if (missing.length === 0) return;

  console.error(`Missing required desktop build tool(s): ${missing.join(", ")}`);
  console.error("Install the native build prerequisites, then rerun: npm run install:desktop");

  if (process.platform === "darwin") {
    console.error("macOS: install Xcode Command Line Tools with `xcode-select --install` and install CMake.");
  } else if (process.platform === "linux") {
    console.error("Linux: install CMake, a C/C++ compiler, libxtst-dev, and libpng++-dev.");
  } else if (process.platform === "win32") {
    console.error("Windows: install CMake and Visual Studio C++ Build Tools.");
  }

  process.exit(1);
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    cwd: root,
    stdio: "ignore"
  });
  return (result.status ?? 1) === 0;
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

function installWorkspacePackage(source, target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, {
    recursive: true,
    filter: (file) => !file.includes(`${source}/node_modules`) && !file.includes(`${source}/coverage`)
  });
}

function run(command, args, options = {}) {
  const executable = process.platform === "win32" && ["npm", "npx"].includes(command) ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
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
