import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { AutomifyError } from "./errors.js";
import { acquireAdapterLock } from "./adapter-locks.js";
import { assertKnownOptions, normalizeLogFile, writeDebugLogFile } from "./runtime.js";
import {
  DESKTOP_RUNTIME_PACKAGE,
  desktopRuntimeDir,
  desktopRuntimeManifestMatches,
  desktopRuntimeManifestPath
} from "./desktop-runtime.js";

const execFileAsync = promisify(execFile);
const LOCAL_DESKTOP_OPTION_KEYS = new Set([
  "nut",
  "viewport",
  "display",
  "displayWidth",
  "displayHeight",
  "environment",
  "waitMs",
  "actionDelayMs",
  "instructions",
  "screenshotPath",
  "lockResource",
  "pixelScale",
  "mouseScaleX",
  "mouseScaleY",
  "mouseOffsetX",
  "mouseOffsetY",
  "mouseAutoDelayMs",
  "keyboardAutoDelayMs",
  "mouse",
  "keyboard",
  "calibration",
  "virtualDisplay",
  "forceVirtualDisplay",
  "virtualDisplayDisplay",
  "virtualDisplayWidth",
  "virtualDisplayHeight",
  "virtualDisplayDepth",
  "virtualDisplayCommand",
  "virtualDisplayArgs",
  "virtualDisplayStartupMs",
  "mouseSpeed",
  "smoothMouseMove",
  "configureMouse",
  "configureKeyboard",
  "macCommandTabHoldMs",
  "macCommandTabSettleMs",
  "silent",
  "debug",
  "logFile",
  "macosDisplayInfo",
  "calibrateScreenshot",
  "requireCalibration",
  "screenshot",
  "onUnknownAction",
  "context",
  "coordinateSpace",
  "actionType",
  "env",
  "spawn"
]);
export const LOCAL_DESKTOP_COMPUTER_OPTION_KEYS = LOCAL_DESKTOP_OPTION_KEYS;
const LOCAL_DISPLAY_KEYS = new Set(["width", "height", "pixelScale"]);
const LOCAL_MOUSE_KEYS = new Set([
  "scaleX",
  "scaleY",
  "offsetX",
  "offsetY",
  "autoDelayMs",
  "speed",
  "smooth",
  "configure"
]);
const LOCAL_KEYBOARD_KEYS = new Set(["autoDelayMs", "configure"]);
const LOCAL_CALIBRATION_KEYS = new Set([
  "pixelScale",
  "mouseScaleX",
  "mouseScaleY",
  "mouseOffsetX",
  "mouseOffsetY",
  "screenshot",
  "required"
]);
const LOCAL_VIRTUAL_DISPLAY_KEYS = new Set(["display", "width", "height", "depth", "command", "args", "startupMs"]);
const LOCAL_DESKTOP_ENVIRONMENTS = new Set(["mac", "windows", "ubuntu", "linux"]);
const LOCAL_DESKTOP_ENVIRONMENT_ALIASES = new Map([
  ["macos", "mac"],
  ["darwin", "mac"],
  ["win32", "windows"],
  ["win", "windows"],
  ["debian", "linux"],
  ["fedora", "linux"],
  ["arch", "linux"]
]);

const KEY_ALIASES = new Map([
  ["alt", "LeftAlt"],
  ["option", "LeftAlt"],
  ["backspace", "Backspace"],
  ["cmd", "LeftCmd"],
  ["command", "LeftCmd"],
  ["control", "LeftControl"],
  ["ctrl", "LeftControl"],
  ["delete", "Delete"],
  ["down", "Down"],
  ["end", "End"],
  ["enter", "Enter"],
  ["esc", "Escape"],
  ["escape", "Escape"],
  ["home", "Home"],
  ["left", "Left"],
  ["meta", "LeftCmd"],
  ["page_down", "PageDown"],
  ["pagedown", "PageDown"],
  ["page_up", "PageUp"],
  ["pageup", "PageUp"],
  ["return", "Enter"],
  ["right", "Right"],
  ["shift", "LeftShift"],
  ["space", "Space"],
  ["tab", "Tab"],
  ["up", "Up"]
]);

const DEFAULT_DESKTOP_ACTION_DELAY_MS = 250;
const DEFAULT_DESKTOP_INSTRUCTIONS = [
  "You are controlling a native desktop through screenshots and mouse/keyboard actions.",
  "Orient from the screenshot first: identify the active app, visible window, focused field, current page, and the specific target required by the task before acting.",
  "Use deterministic entry points. For a website or web app, use the browser address bar only when a browser is clearly focused; otherwise open the browser through a visible Dock/app icon or OS search/launcher, then use the address bar. For app content, use visible in-app search, filters, or navigation controls.",
  "Before using a terminal to run a shell command, confirm the terminal is idle and showing a prompt. If the visible terminal is occupied by a running foreground process, such as the Node.js script that started this session, do not type commands into it; use the OS launcher/Dock/search or a separate idle terminal session instead.",
  "Do not open or use Command+Tab, Alt+Tab, Mission Control, or other cyclic app/window switchers unless the task explicitly asks to switch to the previous app. Cyclic switching is unreliable because the open-app order is unknown.",
  "Do not click as a probe. Click only when the screenshot shows a specific visible target and the purpose of that click is clear from the task or current UI. Prefer named controls, fields, menu items, visible app icons, and address/search fields over unlabeled areas.",
  "If the target is not visible, choose a deterministic recovery path: direct URL, OS search/launcher, in-app search, visible navigation, or a screenshot/wait when loading is visible. Do not repeat nearly identical clicks after no visible change.",
  "After any action that opens an app, navigates, submits input, changes windows, or might trigger loading, use the next screenshot to decide the next step. Stop when the requested result is known; do not keep interacting to confirm unnecessarily."
].join("\n");

export async function createLocalDesktopComputer(options = {}) {
  options = normalizeLocalDesktopOptions(options);
  const releaseLock = await acquireAdapterLock(options.lockResource ?? "local-desktop", {
    label: "local desktop adapter"
  });
  const setupStartedAt = Date.now();
  debugLocalDesktop(options, "setup_start");
  let virtualDisplay;
  try {
    virtualDisplay = await ensureLinuxVirtualDisplay(options);
    const nut = options.nut ?? (await importNut());
    configureNutMouse(nut, options);
    configureNutKeyboard(nut, options);
    const environment = options.environment ?? defaultDesktopEnvironment();
    const screenWidth = await maybeCall(nut.screen?.width, nut.screen);
    const screenHeight = await maybeCall(nut.screen?.height, nut.screen);
    const calibration = await calibrateLocalDesktop(nut, options, {
      screenWidth,
      screenHeight
    });
    const macOSDisplay = await getMacOSDisplayInfo(options, environment);
    let initialScreenshot = calibration.screenshot;
    const displayWidth = options.displayWidth ?? calibration.width ?? screenWidth;
    const displayHeight = options.displayHeight ?? calibration.height ?? screenHeight;
    const coordinateSpace = buildCoordinateSpace(options, {
      displayWidth,
      displayHeight,
      screenWidth,
      screenHeight,
      environment,
      macOSDisplay
    });
    debugLocalDesktop(options, "coordinate_space", summarizeCoordinateSpace(coordinateSpace));
    debugLocalDesktop(options, "setup_complete", {
      displayWidth,
      displayHeight,
      environment,
      screenshotBytes: calibration.screenshot?.byteLength,
      durationMs: Date.now() - setupStartedAt
    });

    return {
      displayWidth,
      displayHeight,
      environment,
      instructions: options.instructions ?? DEFAULT_DESKTOP_INSTRUCTIONS,

      async execute(action, context) {
        await executeLocalDesktopAction(action, {
          ...options,
          actionDelayMs: options.actionDelayMs ?? DEFAULT_DESKTOP_ACTION_DELAY_MS,
          context,
          debug: options.debug,
          coordinateSpace,
          nut
        });
      },

      async screenshot(context) {
        if (typeof options.screenshot === "function") {
          return options.screenshot(context);
        }
        if (context?.initial && initialScreenshot) {
          const screenshot = initialScreenshot;
          initialScreenshot = null;
          return screenshot;
        }
        return captureLocalDesktopScreenshot({
          ...options,
          context,
          nut
        });
      },

      async close() {
        try {
          await virtualDisplay?.close();
        } finally {
          await releaseLock?.();
        }
      }
    };
  } catch (error) {
    await virtualDisplay?.close();
    await releaseLock?.();
    throw error;
  }
}

export async function executeLocalDesktopAction(action, options = {}) {
  options = normalizeLocalDesktopOptions(options);
  const nut = options.nut ?? (await importNut());
  configureNutMouse(nut, options);
  configureNutKeyboard(nut, options);
  debugLocalDesktop(options, "action", {
    action,
    coordinateSpace: summarizeCoordinateSpace(options.coordinateSpace)
  });

  if (!action || typeof action !== "object") {
    throw new AutomifyError("local desktop action must be an object.");
  }

  switch (action.type) {
    case "click":
      await moveMouse(nut, action.x, action.y, { ...options, actionType: "click" });
      await nut.mouse.click(nutButton(nut, action.button));
      await settleAfterAction(options);
      break;
    case "double_click":
      await moveMouse(nut, action.x, action.y, { ...options, actionType: "click" });
      await nut.mouse.doubleClick(nutButton(nut, action.button));
      await settleAfterAction(options);
      break;
    case "scroll":
      await moveMouse(nut, action.x, action.y, options);
      await scrollMouse(nut, action);
      await settleAfterAction(options);
      break;
    case "keypress":
      await pressKeys(nut, action.keys ?? [action.key].filter(Boolean), options);
      await settleAfterAction(options);
      break;
    case "type":
      await nut.keyboard.type(String(action.text ?? ""));
      await settleAfterAction(options);
      break;
    case "wait":
      await delay(options.waitMs ?? action.ms ?? action.duration_ms ?? 1000);
      break;
    case "screenshot":
      break;
    case "move":
      await moveMouse(nut, action.x, action.y, options);
      break;
    case "drag":
      await dragMouse(nut, action, options);
      await settleAfterAction(options);
      break;
    default:
      if (typeof options.onUnknownAction === "function") {
        await options.onUnknownAction(action, options.context);
        break;
      }
      throw new AutomifyError(`Unsupported local desktop action: ${action.type}`);
  }
}

async function settleAfterAction(options = {}) {
  const waitMs = Math.max(0, Number(options.actionDelayMs) || 0);
  if (waitMs > 0) {
    await delay(waitMs);
  }
}

export async function captureLocalDesktopScreenshot(options = {}) {
  options = normalizeLocalDesktopOptions(options);
  const nut = options.nut ?? (await importNut());
  const startedAt = Date.now();
  const result = await captureLocalDesktopScreenshotToFile(nut, options);

  if (!isImageObject(result)) {
    debugLocalDesktop(options, "screenshot_capture", {
      bytes: result?.byteLength,
      durationMs: Date.now() - startedAt
    });
    return result;
  }
  if (typeof nut.saveImage !== "function") {
    throw new AutomifyError(
      "local desktop screenshot capture returned an image object, but saveImage() is unavailable."
    );
  }

  const bytes = await saveNutImageObject(nut, result, options);
  debugLocalDesktop(options, "screenshot_capture", {
    bytes: bytes?.byteLength,
    durationMs: Date.now() - startedAt
  });
  return bytes;
}

function normalizeLocalDesktopOptions(options = {}) {
  assertKnownOptions("local desktop adapter", options, LOCAL_DESKTOP_OPTION_KEYS);
  assertKnownOptions(
    "local desktop display",
    typeof options.display === "object" ? options.display : null,
    LOCAL_DISPLAY_KEYS
  );
  assertKnownOptions("local desktop mouse", options.mouse, LOCAL_MOUSE_KEYS);
  assertKnownOptions("local desktop keyboard", options.keyboard, LOCAL_KEYBOARD_KEYS);
  assertKnownOptions("local desktop calibration", options.calibration, LOCAL_CALIBRATION_KEYS);
  assertKnownOptions(
    "local desktop virtualDisplay",
    typeof options.virtualDisplay === "object" ? options.virtualDisplay : null,
    LOCAL_VIRTUAL_DISPLAY_KEYS
  );
  const viewport = options.viewport ?? {};
  const display = typeof options.display === "object" ? options.display : {};
  const mouse = options.mouse ?? {};
  const keyboard = options.keyboard ?? {};
  const calibration = options.calibration ?? {};
  const virtualDisplay = typeof options.virtualDisplay === "object" ? options.virtualDisplay : {};
  const environment = normalizeLocalDesktopEnvironment(options.environment);
  return {
    ...options,
    debug: options.debug ?? false,
    logFile: normalizeLogFile(options.logFile, "local desktop adapter logFile"),
    display: typeof options.display === "object" ? undefined : options.display,
    displayWidth: options.displayWidth ?? viewport.width ?? display.width,
    displayHeight: options.displayHeight ?? viewport.height ?? display.height,
    environment,
    pixelScale: options.pixelScale ?? display.pixelScale ?? calibration.pixelScale,
    mouseScaleX: options.mouseScaleX ?? mouse.scaleX ?? calibration.mouseScaleX,
    mouseScaleY: options.mouseScaleY ?? mouse.scaleY ?? calibration.mouseScaleY,
    mouseOffsetX: options.mouseOffsetX ?? mouse.offsetX ?? calibration.mouseOffsetX,
    mouseOffsetY: options.mouseOffsetY ?? mouse.offsetY ?? calibration.mouseOffsetY,
    mouseAutoDelayMs: options.mouseAutoDelayMs ?? mouse.autoDelayMs,
    mouseSpeed: options.mouseSpeed ?? mouse.speed,
    smoothMouseMove: options.smoothMouseMove ?? mouse.smooth,
    configureMouse: options.configureMouse ?? mouse.configure,
    keyboardAutoDelayMs: options.keyboardAutoDelayMs ?? keyboard.autoDelayMs,
    configureKeyboard: options.configureKeyboard ?? keyboard.configure,
    virtualDisplay: typeof options.virtualDisplay === "object" ? true : options.virtualDisplay,
    virtualDisplayDisplay: options.virtualDisplayDisplay ?? virtualDisplay.display,
    virtualDisplayWidth: options.virtualDisplayWidth ?? virtualDisplay.width,
    virtualDisplayHeight: options.virtualDisplayHeight ?? virtualDisplay.height,
    virtualDisplayDepth: options.virtualDisplayDepth ?? virtualDisplay.depth,
    virtualDisplayCommand: options.virtualDisplayCommand ?? virtualDisplay.command,
    virtualDisplayArgs: options.virtualDisplayArgs ?? virtualDisplay.args,
    virtualDisplayStartupMs: options.virtualDisplayStartupMs ?? virtualDisplay.startupMs,
    calibrateScreenshot: options.calibrateScreenshot ?? calibration.screenshot,
    requireCalibration: options.requireCalibration ?? calibration.required
  };
}

async function captureLocalDesktopScreenshotToFile(nut, options = {}) {
  if (typeof nut.screen?.capture !== "function") {
    throw new AutomifyError("local desktop screen.capture() is unavailable.");
  }

  const filename = `automify-nut-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = options.screenshotPath ? undefined : tmpdir();
  const requestedPath = options.screenshotPath;
  let capturedPath;
  try {
    capturedPath = await nut.screen.capture(requestedPath ?? filename, nut.FileType?.PNG, directory);
  } catch (error) {
    throw new AutomifyError(
      `local desktop screenshot capture failed. ${localDesktopRuntimeHelp(options.environment)}${errorMessageSuffix(error)}`,
      { cause: error }
    );
  }

  if (isByteLike(capturedPath)) return capturedPath;
  if (isImageObject(capturedPath)) return capturedPath;

  const path = capturedPath ?? requestedPath ?? join(directory, `${filename}.png`);

  try {
    return await readFile(path);
  } finally {
    if (!options.screenshotPath) {
      await unlink(path).catch(() => {});
    }
  }
}

async function calibrateLocalDesktop(nut, options, screen) {
  if (options.calibrateScreenshot === false || typeof options.screenshot === "function") {
    return {};
  }

  try {
    const screenshot = await captureLocalDesktopScreenshot({
      ...options,
      nut
    });
    const dimensions = pngDimensions(screenshot);
    return {
      screenshot,
      width: dimensions?.width,
      height: dimensions?.height
    };
  } catch (error) {
    if (options.requireCalibration !== false) {
      throw error;
    }
    return {
      width: screen.screenWidth,
      height: screen.screenHeight
    };
  }
}

async function saveNutImageObject(nut, image, options = {}) {
  const path =
    options.screenshotPath ?? join(tmpdir(), `automify-nut-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);

  try {
    if (nut.saveImage.length <= 1) {
      await nut.saveImage({ image, path });
    } else {
      await nut.saveImage(image, path);
    }
    return await readFile(path);
  } finally {
    if (!options.screenshotPath) {
      await unlink(path).catch(() => {});
    }
  }
}

async function importNut() {
  let runtimeError;
  try {
    const runtimeNut = importNutFromDesktopRuntime();
    if (runtimeNut) return runtimeNut;
  } catch (error) {
    runtimeError = error;
  }

  try {
    return await import(DESKTOP_RUNTIME_PACKAGE);
  } catch (error) {
    const runtimeSuffix = runtimeError ? ` Cached desktop runtime import failed: ${runtimeError.message}` : "";
    throw new AutomifyError(
      `createLocalDesktopComputer requires the local desktop adapter dependency built from source. ${localDesktopInstallHelp()} After the OS prerequisites are available, run: npx automify-install-desktop.${runtimeSuffix}`,
      { cause: error }
    );
  }
}

function importNutFromDesktopRuntime() {
  const manifestPath = desktopRuntimeManifestPath();
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
  if (!desktopRuntimeManifestMatches(manifest)) return null;

  const runtimeRequire = createRequire(join(desktopRuntimeDir(), "automify-desktop-runtime.cjs"));
  return runtimeRequire(DESKTOP_RUNTIME_PACKAGE);
}

function normalizeLocalDesktopEnvironment(environment) {
  if (environment == null) return undefined;
  if (typeof environment !== "string" || environment.trim() === "") {
    throw new AutomifyError(
      'local desktop environment must be "mac", "windows", or "linux". "ubuntu" is also accepted for compatibility.'
    );
  }

  const normalized = environment.trim().toLowerCase();
  const canonical = LOCAL_DESKTOP_ENVIRONMENT_ALIASES.get(normalized) ?? normalized;
  if (LOCAL_DESKTOP_ENVIRONMENTS.has(canonical)) return canonical;

  throw new AutomifyError(
    `Unsupported local desktop environment ${JSON.stringify(environment)}. Use "mac" for macOS, "windows" for Windows, or "linux" for Linux. "ubuntu" is also accepted for compatibility. Use instructions for OS-specific guidance, not a custom environment value.`
  );
}

function localDesktopInstallHelp(platform = process.platform) {
  if (platform === "darwin") {
    return "On macOS, install Xcode Command Line Tools with `xcode-select --install` and make sure `cmake --version` works, for example after `brew install cmake`.";
  }
  if (platform === "win32") {
    return "On Windows, install Visual Studio C++ Build Tools and make sure `cmake --version` works, for example after `winget install Kitware.CMake`.";
  }
  if (platform === "linux") {
    return "On Linux, install the native build tools for your distro before running the desktop installer; it does not verify every native library package. Debian/Ubuntu need `git build-essential cmake pkg-config libx11-dev libxtst-dev libpng++-dev`; Fedora needs `gcc-c++ make cmake libXtst-devel libpng-devel`; Arch needs `base-devel cmake libxtst libpng`. Headless hosts also need `xvfb` unless DISPLAY is managed externally.";
  }
  return "Install the native build tools and CMake for this OS.";
}

function localDesktopRuntimeHelp(environment = defaultDesktopEnvironment()) {
  if (environment === "mac") {
    return "On macOS, grant the terminal or Node.js process Screen Recording and Accessibility permissions, then restart the process.";
  }
  if (environment === "windows") {
    return "On Windows, make sure the desktop session is unlocked and the process is allowed to control the desktop.";
  }
  return "On Linux, make sure DISPLAY points to a running X server; on headless hosts install xvfb or pass virtualDisplay options.";
}

function errorMessageSuffix(error) {
  const message = error?.message;
  return message ? ` Original error: ${message}` : "";
}

async function maybeCall(fn, thisArg) {
  if (typeof fn !== "function") return undefined;
  return fn.call(thisArg);
}

async function getMacOSDisplayInfo(options, environment) {
  if (environment !== "mac" || options.macosDisplayInfo === false) {
    return null;
  }

  if (options.macosDisplayInfo && typeof options.macosDisplayInfo === "object") {
    return options.macosDisplayInfo;
  }

  try {
    const script = `
ObjC.import("AppKit");
const screen = $.NSScreen.mainScreen;
if (!screen) {
  JSON.stringify(null);
} else {
  const frame = screen.frame;
  const visible = screen.visibleFrame;
  JSON.stringify({
    width: frame.size.width,
    height: frame.size.height,
    visibleX: visible.origin.x,
    visibleY: visible.origin.y,
    visibleWidth: visible.size.width,
    visibleHeight: visible.size.height,
    backingScaleFactor: screen.backingScaleFactor
  });
}
`;
    const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], { timeout: 1500 });
    const parsed = JSON.parse(stdout.trim());
    return parsed && parsed.width > 0 && parsed.height > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function defaultDesktopEnvironment() {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "windows";
  return "ubuntu";
}

async function ensureLinuxVirtualDisplay(options = {}) {
  if (process.platform !== "linux" || options.virtualDisplay === false) {
    return null;
  }
  if (options.nut && options.forceVirtualDisplay !== true) {
    return null;
  }

  const env = options.env ?? process.env;
  if (env.DISPLAY && options.forceVirtualDisplay !== true) {
    return null;
  }

  const display = normalizeXDisplay(options.display ?? options.virtualDisplayDisplay ?? ":99");
  const width = positiveInteger(options.virtualDisplayWidth) ?? positiveInteger(options.displayWidth) ?? 1440;
  const height = positiveInteger(options.virtualDisplayHeight) ?? positiveInteger(options.displayHeight) ?? 900;
  const depth = positiveInteger(options.virtualDisplayDepth) ?? 24;
  const command = options.virtualDisplayCommand ?? "Xvfb";
  const args = options.virtualDisplayArgs ?? [
    display,
    "-screen",
    "0",
    `${width}x${height}x${depth}`,
    "-nolisten",
    "tcp"
  ];
  const spawnImpl = options.spawn ?? spawn;

  debugLocalDesktop(options, "virtual_display_start", { command, args, display, width, height, depth });
  const child = spawnImpl(command, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...env
    }
  });

  await waitForSpawn(child, options.virtualDisplayStartupMs ?? 250, command);
  child.unref?.();
  env.DISPLAY = display;
  debugLocalDesktop(options, "virtual_display_ready", { display, pid: child.pid });

  return {
    display,
    process: child,
    async close() {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };
}

function waitForSpawn(child, startupMs, command) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => {
        settled = true;
        cleanup();
        resolve();
      },
      Math.max(0, Number(startupMs) || 0)
    );

    function cleanup() {
      clearTimeout(timer);
      child.off?.("error", onError);
      child.off?.("exit", onExit);
    }

    function onError(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new AutomifyError(
          `Unable to start Linux virtual display with ${command}. Install Xvfb or pass virtualDisplay: false to use an existing DISPLAY.`,
          { cause: error }
        )
      );
    }

    function onExit(code) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new AutomifyError(`Linux virtual display exited during startup with code ${code}.`));
    }

    child.once?.("error", onError);
    child.once?.("exit", onExit);
  });
}

function normalizeXDisplay(display) {
  const value = String(display || ":99").trim();
  return value.startsWith(":") ? value : `:${value}`;
}

function nutButton(nut, button) {
  if (button === "right") return nut.Button?.RIGHT ?? nut.Button?.Right ?? "right";
  if (button === "middle") return nut.Button?.MIDDLE ?? nut.Button?.Middle ?? "middle";
  return nut.Button?.LEFT ?? nut.Button?.Left ?? "left";
}

async function moveMouse(nut, x, y, options = {}) {
  const target = point(nut, x, y, options);
  const transform = describePointTransform(
    x,
    y,
    options.coordinateSpace
      ? {
          ...options.coordinateSpace,
          actionType: options.actionType
        }
      : null
  );
  debugLocalDesktop(options, "move", {
    ...transform,
    output: { x: target.x, y: target.y },
    actionType: options.actionType
  });
  if (options.smoothMouseMove !== true && typeof nut.mouse.setPosition === "function") {
    await nut.mouse.setPosition(target);
    return;
  }
  await nut.mouse.move(nut.straightTo(target));
}

async function dragMouse(nut, action, options = {}) {
  const start = action.path?.[0] ?? action;
  const end = action.path?.at(-1) ?? action;
  await moveMouse(nut, start.x, start.y, options);
  await nut.mouse.drag(nut.straightTo(point(nut, end.x, end.y, options)));
}

async function scrollMouse(nut, action) {
  const scrollY = Number(action.scroll_y ?? action.delta_y ?? action.deltaY ?? 0);
  const scrollX = Number(action.scroll_x ?? action.delta_x ?? action.deltaX ?? 0);
  const amount = Math.max(1, Math.ceil(Math.max(Math.abs(scrollY), Math.abs(scrollX)) / 120));

  if (Math.abs(scrollX) > Math.abs(scrollY) && scrollX !== 0) {
    if (scrollX > 0 && typeof nut.mouse.scrollRight === "function") return nut.mouse.scrollRight(amount);
    if (scrollX < 0 && typeof nut.mouse.scrollLeft === "function") return nut.mouse.scrollLeft(amount);
  }

  if (scrollY > 0) return nut.mouse.scrollDown(amount);
  if (scrollY < 0) return nut.mouse.scrollUp(amount);
}

async function pressKeys(nut, keys, options = {}) {
  if (isMacCommandTab(keys, options)) {
    await pressMacCommandTab(nut, options);
    return;
  }

  const normalized = keys.map((key) => nutKey(nut, key)).filter((key) => key != null);
  if (normalized.length === 0) {
    throw new AutomifyError("keypress action did not include any keys.");
  }
  await nut.keyboard.pressKey(...normalized);
  if (typeof nut.keyboard.releaseKey === "function") {
    await nut.keyboard.releaseKey(...normalized);
  }
}

async function pressMacCommandTab(nut, options) {
  const command = nut.Key?.LeftCmd ?? nut.Key?.LeftSuper ?? "cmd";
  const tab = nut.Key?.Tab ?? "tab";
  const holdMs = Math.max(0, Number(options.macCommandTabHoldMs ?? 500) || 0);
  const settleMs = Math.max(0, Number(options.macCommandTabSettleMs ?? 80) || 0);

  debugLocalDesktop(options, "keyboard", {
    method: "mac_command_tab",
    holdMs,
    settleMs
  });

  await nut.keyboard.pressKey(command);
  if (settleMs > 0) {
    await delay(settleMs);
  }
  await nut.keyboard.pressKey(tab);
  if (settleMs > 0) {
    await delay(settleMs);
  }
  if (typeof nut.keyboard.releaseKey === "function") {
    await nut.keyboard.releaseKey(tab);
  }
  if (holdMs > 0) {
    await delay(holdMs);
  }
  if (typeof nut.keyboard.releaseKey === "function") {
    await nut.keyboard.releaseKey(command);
  }
}

function isMacCommandTab(keys, options = {}) {
  const environment = options.environment ?? options.coordinateSpace?.environment ?? defaultDesktopEnvironment();
  if (environment !== "mac") return false;

  const normalized = new Set(keys.map((key) => String(key).trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean));
  return normalized.has("tab") && ["cmd", "command", "meta"].some((key) => normalized.has(key));
}

function nutKey(nut, key) {
  const raw = String(key);
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, "_");
  const alias = KEY_ALIASES.get(normalized);
  if (alias && nut.Key?.[alias] != null) return nut.Key[alias];
  if (raw.length === 1) {
    const upper = raw.toUpperCase();
    return nut.Key?.[upper] ?? raw;
  }
  return nut.Key?.[raw] ?? nut.Key?.[capitalize(normalized)] ?? raw;
}

function point(nut, x, y, options = {}) {
  const coordinateSpace = options.coordinateSpace
    ? {
        ...options.coordinateSpace,
        actionType: options.actionType
      }
    : null;
  const scaled = scalePoint(x, y, coordinateSpace);
  const safePoint = {
    x: Math.max(0, Math.round(scaled.x)),
    y: Math.max(0, Math.round(scaled.y))
  };

  if (typeof nut.Point === "function") {
    return new nut.Point(safePoint.x, safePoint.y);
  }

  return safePoint;
}

function scalePoint(x, y, coordinateSpace) {
  const point = {
    x: Number(x) || 0,
    y: Number(y) || 0
  };

  if (!coordinateSpace) return point;

  const scaled = {
    x: point.x * coordinateSpace.mouseScaleX + coordinateSpace.mouseOffsetX,
    y: point.y * coordinateSpace.mouseScaleY + coordinateSpace.mouseOffsetY
  };

  return scaled;
}

function describePointTransform(x, y, coordinateSpace) {
  if (!coordinateSpace) {
    return {
      input: { x, y },
      output: { x: Number(x) || 0, y: Number(y) || 0 },
      coordinateSpace: null
    };
  }

  const input = {
    x: Number(x) || 0,
    y: Number(y) || 0
  };
  const scaled = {
    x: input.x * coordinateSpace.mouseScaleX + coordinateSpace.mouseOffsetX,
    y: input.y * coordinateSpace.mouseScaleY + coordinateSpace.mouseOffsetY
  };
  return {
    input,
    scaled,
    output: scaled,
    coordinateSpace: summarizeCoordinateSpace(coordinateSpace)
  };
}

function buildCoordinateSpace(options, screen) {
  const macOSDisplay = screen.macOSDisplay;
  const environment = screen.environment ?? options.environment ?? defaultDesktopEnvironment();
  const pixelScale =
    positiveNumber(options.pixelScale) ??
    positiveNumber(macOSDisplay?.backingScaleFactor) ??
    inferPixelScale({ ...screen, environment }, options);
  const defaultScale = 1 / pixelScale;
  const mouseWidth =
    measuredMouseSize("width", { ...screen, environment, macOSDisplay }) ??
    scaledDisplaySize(screen.displayWidth, defaultScale);
  const mouseHeight =
    measuredMouseSize("height", { ...screen, environment, macOSDisplay }) ??
    scaledDisplaySize(screen.displayHeight, defaultScale);
  const mouseScaleX = scaleRatio(mouseWidth, screen.displayWidth) ?? defaultScale;
  const mouseScaleY = scaleRatio(mouseHeight, screen.displayHeight) ?? defaultScale;

  return {
    ...screen,
    pixelScale,
    mouseWidth,
    mouseHeight,
    mouseScaleX: positiveNumber(options.mouseScaleX) ?? mouseScaleX,
    mouseScaleY: positiveNumber(options.mouseScaleY) ?? mouseScaleY,
    mouseOffsetX: finiteNumber(options.mouseOffsetX) ?? 0,
    mouseOffsetY: finiteNumber(options.mouseOffsetY) ?? 0,
    actionType: options.actionType
  };
}

function measuredMouseSize(axis, { environment, macOSDisplay, screenWidth, screenHeight }) {
  const macOSValue = positiveNumber(macOSDisplay?.[axis]);
  if (macOSValue) return macOSValue;
  if (environment === "mac") return null;
  return positiveNumber(axis === "width" ? screenWidth : screenHeight);
}

function scaledDisplaySize(size, scale) {
  const numericSize = positiveNumber(size);
  const numericScale = positiveNumber(scale);
  if (!numericSize || !numericScale) return undefined;
  return numericSize * numericScale;
}

function scaleRatio(target, source) {
  const numericTarget = positiveNumber(target);
  const numericSource = positiveNumber(source);
  if (!numericTarget || !numericSource) return null;
  return numericTarget / numericSource;
}

function inferPixelScale({ displayWidth, displayHeight, screenWidth, screenHeight }, options = {}) {
  const environment = options.environment ?? defaultDesktopEnvironment();
  const width = positiveNumber(displayWidth) ?? positiveNumber(screenWidth);
  const height = positiveNumber(displayHeight) ?? positiveNumber(screenHeight);
  if (!width || !height) return 1;

  if (environment !== "mac") {
    const widthScale = scaleRatio(width, screenWidth);
    const heightScale = scaleRatio(height, screenHeight);
    if (widthScale && heightScale && nearlyEqual(widthScale, heightScale)) {
      return widthScale;
    }
    return 1;
  }

  // libnut reports macOS screen size in backing pixels, while CGEvent mouse
  // coordinates use logical points. Built-in Retina displays are 2x here.
  if (width >= 2000 || height >= 1400) return 2;
  return 1;
}

function nearlyEqual(left, right, epsilon = 0.01) {
  return Math.abs(left - right) <= epsilon;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configureNutMouse(nut, options = {}) {
  if (!nut.mouse?.config || options.configureMouse === false) return;

  if (options.mouseAutoDelayMs != null) {
    nut.mouse.config.autoDelayMs = Math.max(0, Number(options.mouseAutoDelayMs) || 0);
  } else if (nut.mouse.config.autoDelayMs == null || nut.mouse.config.autoDelayMs > 0) {
    nut.mouse.config.autoDelayMs = 0;
  }

  if (options.mouseSpeed != null) {
    nut.mouse.config.mouseSpeed = Math.max(0, Number(options.mouseSpeed) || 0);
  }
}

function configureNutKeyboard(nut, options = {}) {
  if (!nut.keyboard?.config || options.configureKeyboard === false) return;

  if (options.keyboardAutoDelayMs != null) {
    nut.keyboard.config.autoDelayMs = Math.max(0, Number(options.keyboardAutoDelayMs) || 0);
  } else if (nut.keyboard.config.autoDelayMs == null || nut.keyboard.config.autoDelayMs > 0) {
    nut.keyboard.config.autoDelayMs = 0;
  }
}

function debugLocalDesktop(options, message, details) {
  writeDebugLogFile(options.logFile, "automify:local-desktop", message, details, { silent: options.silent });
  if (options.silent || !options.debug) return;
  const label = `[automify:local-desktop] ${message}`;
  if (typeof options.debug === "function") {
    options.debug(label, details);
    return;
  }
  console.error(formatDesktopLog(label, details));
}

function formatDesktopLog(label, details) {
  if (!details || typeof details !== "object") return label;
  const parts = [];
  const add = (key, value) => {
    if (value == null || value === "") return;
    parts.push(`${key}=${value}`);
  };

  add("action", describeDesktopAction(details.action));
  if (details.input) add("input", `${details.input.x ?? "?"},${details.input.y ?? "?"}`);
  if (details.output) add("output", `${details.output.x ?? "?"},${details.output.y ?? "?"}`);
  add("actionType", details.actionType);
  add("method", details.method);
  add("holdMs", details.holdMs);
  add("settleMs", details.settleMs);
  add("bytes", details.bytes);
  add("durationMs", details.durationMs);
  add("environment", details.environment);
  if (details.displayWidth && details.displayHeight) add("display", `${details.displayWidth}x${details.displayHeight}`);
  if (details.screenWidth && details.screenHeight) add("screen", `${details.screenWidth}x${details.screenHeight}`);
  if (details.coordinateSpace?.mouseScaleX != null || details.coordinateSpace?.mouseScaleY != null) {
    add("mouseScale", `${details.coordinateSpace.mouseScaleX ?? "?"},${details.coordinateSpace.mouseScaleY ?? "?"}`);
  }
  if (details.coordinateSpace?.mouseOffsetX != null || details.coordinateSpace?.mouseOffsetY != null) {
    add("mouseOffset", `${details.coordinateSpace.mouseOffsetX ?? "?"},${details.coordinateSpace.mouseOffsetY ?? "?"}`);
  }
  if (details.coordinateSpace?.pixelScale != null) add("pixelScale", details.coordinateSpace.pixelScale);

  return parts.length ? `${label} ${parts.join(" ")}` : label;
}

function describeDesktopAction(action) {
  if (!action?.type) return "";
  const parts = [action.type];
  if (action.x != null || action.y != null) parts.push(`@${action.x ?? "?"},${action.y ?? "?"}`);
  if (action.button) parts.push(`button:${action.button}`);
  const keys = action.keys ?? [action.key].filter(Boolean);
  if (keys?.length) parts.push(`keys:${keys.join("+")}`);
  if (action.text != null) parts.push(`text:${JSON.stringify(String(action.text).slice(0, 80))}`);
  if (action.ms != null || action.duration_ms != null) parts.push(`ms:${action.ms ?? action.duration_ms}`);
  if (action.scroll_x != null || action.scroll_y != null)
    parts.push(`scroll:${action.scroll_x ?? 0},${action.scroll_y ?? 0}`);
  if (action.delta_x != null || action.delta_y != null)
    parts.push(`delta:${action.delta_x ?? 0},${action.delta_y ?? 0}`);
  return parts.join(":");
}

function summarizeCoordinateSpace(coordinateSpace) {
  if (!coordinateSpace) return null;
  return {
    environment: coordinateSpace.environment,
    displayWidth: coordinateSpace.displayWidth,
    displayHeight: coordinateSpace.displayHeight,
    screenWidth: coordinateSpace.screenWidth,
    screenHeight: coordinateSpace.screenHeight,
    mouseWidth: coordinateSpace.mouseWidth,
    mouseHeight: coordinateSpace.mouseHeight,
    pixelScale: coordinateSpace.pixelScale,
    mouseScaleX: coordinateSpace.mouseScaleX,
    mouseScaleY: coordinateSpace.mouseScaleY,
    mouseOffsetX: coordinateSpace.mouseOffsetX,
    mouseOffsetY: coordinateSpace.mouseOffsetY
  };
}

function pngDimensions(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 24) return null;
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isByteLike(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof ArrayBuffer;
}

function isImageObject(value) {
  return value && typeof value === "object" && !isByteLike(value);
}
