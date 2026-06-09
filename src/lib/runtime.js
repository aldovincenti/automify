import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { AutomifyError } from "./errors.js";

export const AUTOMIFY_OPTION_KEYS = new Set([
  "openaiApiKey",
  "client",
  "computer",
  "model",
  "baseURL",
  "fetchImpl",
  "maxSteps",
  "limits",
  "request",
  "requestOptions",
  "viewport",
  "displayWidth",
  "displayHeight",
  "environment",
  "reasoning",
  "safety",
  "safetyIdentifier",
  "allowedDomains",
  "hooks",
  "onStep",
  "onRequest",
  "onResponse",
  "onComplete",
  "screenshot",
  "redactScreenshot",
  "screenshotDetail",
  "screenshotMaxWidth",
  "screenshotMaxHeight",
  "screenshotResize",
  "sendInitialScreenshot",
  "initialScreenshot",
  "finalScreenshot",
  "actionScreenshots",
  "screenshots",
  "recording",
  "screenRecording",
  "trace",
  "silent",
  "debug",
  "logFile"
]);

export async function callHook(hook, ...args) {
  if (typeof hook === "function") {
    await hook(...args);
  }
}

export function debugLog(debug, scope, message, details, options = {}) {
  if (options.silent || !debug) return;
  const label = `[${scope}] ${message}`;
  if (typeof debug === "function") {
    debug(label, details);
    return;
  }
  if (options.full) {
    console.error(formatFullLog(label, details));
    return;
  }
  console.error(formatDefaultLog(label, details));
}

export function logLogger(debug, options = {}) {
  if (options.silent || !debug) return null;
  if (typeof debug === "function") return debug;
  return console.error;
}

export function writeDebugLogFile(logFile, scope, message, details, options = {}) {
  if (options.silent || !logFile) return;

  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(
      logFile,
      `${JSON.stringify({
        at: new Date().toISOString(),
        scope,
        message,
        label: `[${scope}] ${message}`,
        details
      })}\n`
    );
  } catch {
    // Logging must not change automation behavior.
  }
}

export function normalizeLogFile(value, scope = "logFile") {
  if (value == null || value === false) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new AutomifyError(`${scope} must be a non-empty file path.`);
  }
  return value;
}

function formatDefaultLog(label, details) {
  const summary = summarizeLogDetails(details);
  return summary ? `${label} ${summary}` : label;
}

function formatFullLog(label, details) {
  if (details === undefined) return label;
  return `${label} ${JSON.stringify(details, null, 2)}`;
}

function summarizeLogDetails(details) {
  if (!details || typeof details !== "object") return "";
  const parts = [];
  const add = (key, value) => {
    if (value == null || value === "") return;
    parts.push(`${key}=${value}`);
  };

  if (details.label) parts.push(details.label);
  if (details.index != null) add("step", details.index);
  add("phase", details.phase);
  add("step", details.step);
  add("action", describeAction(details.action));
  if (details.executableAction && JSON.stringify(details.executableAction) !== JSON.stringify(details.action)) {
    add("executed", describeAction(details.executableAction));
  }
  if (Array.isArray(details.actions) && details.actions.length > 1) {
    add(
      "actions",
      details.actions
        .map((action) => describeAction(action))
        .filter(Boolean)
        .join(",")
    );
  }
  add("call", details.call?.call_id ?? details.callId);
  if (details.safetyChecks?.length || details.call?.pending_safety_checks?.length) {
    add("safetyChecks", details.safetyChecks?.length ?? details.call.pending_safety_checks.length);
  }
  if (details.currentUrl) add("url", JSON.stringify(details.currentUrl));

  if (details.payload) {
    add("phase", details.meta?.phase);
    add("step", details.meta?.step);
    add("model", details.payload.model);
    add("previous", shortenId(details.payload.previous_response_id));
    add("tools", details.payload.toolCount);
    add("inputs", details.payload.inputCount);
  }

  if (details.response) {
    add("phase", details.meta?.phase);
    add("step", details.meta?.step);
    add("response", shortenId(details.response.id));
    if (details.response.outputTypes?.length) add("outputs", details.response.outputTypes.join(","));
    if (details.response.actions?.length) add("actions", details.response.actions.join(","));
  }

  if (details.command?.command) add("command", JSON.stringify(details.command.command));
  if (details.command?.cwd) add("cwd", JSON.stringify(details.command.cwd));
  add("cwd", details.cwd ? JSON.stringify(details.cwd) : undefined);
  add("timeoutMs", details.command?.timeoutMs ?? details.timeoutMs);
  add("exitCode", details.exitCode);
  add("signal", details.signal);
  if (details.timedOut != null) add("timedOut", details.timedOut);
  add("stdoutLength", details.stdoutLength);
  add("stderrLength", details.stderrLength);
  if (typeof details.stdout === "string" && details.stdout.length > 0) add("stdout", previewText(details.stdout));
  if (typeof details.stderr === "string" && details.stderr.length > 0) add("stderr", previewText(details.stderr));
  if (details.status) add("status", details.status);
  if (details.ok != null) add("ok", details.ok);
  if (details.completed != null) add("completed", details.completed);
  if (details.stopReason) add("stop", details.stopReason);
  if (Array.isArray(details.steps)) add("steps", details.steps.length);
  if (details.containerName) add("container", details.containerName);
  if (details.image) add("image", details.image);
  if (details.width && details.height) add("size", `${details.width}x${details.height}`);
  if (details.display) add("display", details.display);
  if (details.installDependencies != null) add("installDeps", details.installDependencies);
  if (Array.isArray(details.args)) add("args", JSON.stringify(details.args));
  if (details.path) add("path", JSON.stringify(details.path));
  add("bytes", details.bytes);
  add("writtenBytes", details.writtenBytes);
  if (details.originalWidth && details.originalHeight)
    add("original", `${details.originalWidth}x${details.originalHeight}`);
  if (details.resized != null) add("resized", details.resized);
  if (details.reused != null) add("reused", details.reused);
  add("detail", details.detail);
  add("durationMs", details.durationMs);

  return parts.join(" ");
}

export function mergeRequestOptions(requestOptions, payload) {
  if (!requestOptions) return payload;
  return {
    ...requestOptions,
    ...payload
  };
}

export const DO_OPTION_KEYS = new Set([
  "data",
  "evaluate",
  "filesToEvaluate",
  "model",
  "maxSteps",
  "limits",
  "request",
  "requestOptions",
  "output",
  "displayWidth",
  "displayHeight",
  "environment",
  "reasoning",
  "safetyIdentifier",
  "allowedDomains",
  "safety",
  "onStep",
  "onComplete",
  "hooks",
  "redactScreenshot",
  "screenshotDetail",
  "screenshotMaxWidth",
  "screenshotMaxHeight",
  "screenshotResize",
  "sendInitialScreenshot",
  "initialScreenshot",
  "finalScreenshot",
  "actionScreenshots",
  "screenshots",
  "recording",
  "screenRecording",
  "screenshot",
  "trace",
  "silent",
  "onSafetyCheck",
  "cwd",
  "env",
  "shell",
  "timeoutMs",
  "approval",
  "allowedCommands",
  "blockedCommands",
  "instructions",
  "confirmCommand",
  "command",
  "commands"
]);
export const COMMAND_OPTION_KEYS = new Set([
  "cwd",
  "env",
  "shell",
  "timeoutMs",
  "timeout",
  "approval",
  "allow",
  "allowed",
  "allowedCommands",
  "block",
  "blocked",
  "blockedCommands",
  "confirm",
  "confirmCommand"
]);

export function normalizeDoArguments(dataOrOptions, maybeOptions) {
  if (maybeOptions !== undefined) {
    throw new AutomifyError("do() now accepts a single run object: do(instruction, { data, output, ...options }).");
  }

  if (dataOrOptions === undefined) {
    return { data: {}, options: {} };
  }

  if (!dataOrOptions || typeof dataOrOptions !== "object" || Array.isArray(dataOrOptions)) {
    throw new AutomifyError("do() run options must be an object, for example { data: {...}, output }.");
  }

  const unknownKeys = Object.keys(dataOrOptions).filter((key) => !DO_OPTION_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new AutomifyError(
      `${unknownOptionMessage("do()", unknownKeys[0], DO_OPTION_KEYS)} Put input values under data: { ${unknownKeys[0]}: ... }.`
    );
  }

  const { data = {}, ...rawOptions } = dataOrOptions;
  return {
    data: data ?? {},
    options: normalizeDoOptionAliases(rawOptions)
  };
}

export function assertKnownOptions(scope, options, allowedKeys) {
  if (options == null) return;
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new AutomifyError(`${scope} options must be an object.`);
  }

  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys);
  const unknownKey = Object.keys(options).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new AutomifyError(unknownOptionMessage(scope, unknownKey, allowed));
  }
}

export function mergeOptionKeys(...sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

export function pickKnownOptions(options, allowedKeys) {
  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys);
  return Object.fromEntries(Object.entries(options ?? {}).filter(([key]) => allowed.has(key)));
}

export function normalizeAutomifyOptions(options = {}) {
  assertKnownOptions("Automify", options, AUTOMIFY_OPTION_KEYS);
  const { viewport, limits, request, safety, hooks, screenshots, screenshot, recording, screenRecording, ...rest } =
    options;
  const viewportOptions = viewport ?? {};
  const limitOptions = limits ?? {};
  const safetyOptions = safety ?? {};
  const hookOptions = hooks ?? {};
  const screenshotPaths = screenshots ?? {};
  const screenshotOptions = screenshot ?? {};

  return cleanUndefined({
    ...rest,
    debug: rest.debug ?? false,
    logFile: normalizeLogFile(rest.logFile, "Automify logFile"),
    maxSteps: rest.maxSteps ?? limitOptions.steps ?? limitOptions.maxSteps,
    requestOptions: rest.requestOptions ?? request,
    displayWidth: rest.displayWidth ?? viewportOptions.width,
    displayHeight: rest.displayHeight ?? viewportOptions.height,
    safetyIdentifier: rest.safetyIdentifier ?? safetyOptions.identifier ?? safetyOptions.safetyIdentifier,
    allowedDomains: rest.allowedDomains ?? safetyOptions.domains ?? safetyOptions.allowedDomains,
    onStep: rest.onStep ?? hookOptions.step ?? hookOptions.onStep,
    onComplete: rest.onComplete ?? hookOptions.complete ?? hookOptions.onComplete,
    initialScreenshot: rest.initialScreenshot ?? screenshotPaths.initial,
    finalScreenshot: rest.finalScreenshot ?? screenshotPaths.final,
    actionScreenshots: rest.actionScreenshots ?? screenshotPaths.actions ?? screenshotPaths.actionScreenshots,
    screenRecording:
      rest.screenRecording ?? screenRecording ?? rest.recording ?? recording ?? screenshotPaths.recording,
    screenshotDetail: rest.screenshotDetail ?? screenshotOptions.detail,
    screenshotMaxWidth: rest.screenshotMaxWidth ?? screenshotOptions.maxWidth ?? screenshotOptions.screenshotMaxWidth,
    screenshotMaxHeight:
      rest.screenshotMaxHeight ?? screenshotOptions.maxHeight ?? screenshotOptions.screenshotMaxHeight,
    screenshotResize: rest.screenshotResize ?? screenshotOptions.resize ?? screenshotOptions.screenshotResize,
    sendInitialScreenshot: rest.sendInitialScreenshot ?? screenshotOptions.sendInitialScreenshot,
    redactScreenshot: rest.redactScreenshot ?? screenshotOptions.redact ?? screenshotOptions.redactScreenshot
  });
}

function normalizeDoOptionAliases(options) {
  const {
    evaluate,
    limits,
    request,
    safety,
    hooks,
    screenshots,
    screenshot,
    recording,
    screenRecording,
    command,
    commands,
    ...rest
  } = options;

  const commandOptions = commands ?? command;
  assertKnownOptions("do() command", commandOptions, COMMAND_OPTION_KEYS);
  return cleanUndefined({
    ...rest,
    filesToEvaluate: rest.filesToEvaluate ?? evaluate,
    maxSteps: rest.maxSteps ?? limits?.steps ?? limits?.maxSteps,
    requestOptions: rest.requestOptions ?? request,
    safetyIdentifier: rest.safetyIdentifier ?? safety?.identifier ?? safety?.safetyIdentifier,
    allowedDomains: rest.allowedDomains ?? safety?.domains ?? safety?.allowedDomains,
    onSafetyCheck: rest.onSafetyCheck ?? safety?.onCheck ?? safety?.onSafetyCheck,
    onStep: rest.onStep ?? hooks?.step ?? hooks?.onStep,
    onComplete: rest.onComplete ?? hooks?.complete ?? hooks?.onComplete,
    initialScreenshot: rest.initialScreenshot ?? screenshots?.initial,
    finalScreenshot: rest.finalScreenshot ?? screenshots?.final,
    actionScreenshots: rest.actionScreenshots ?? screenshots?.actions ?? screenshots?.actionScreenshots,
    screenRecording: rest.screenRecording ?? screenRecording ?? rest.recording ?? recording ?? screenshots?.recording,
    screenshotDetail: rest.screenshotDetail ?? screenshot?.detail,
    screenshotMaxWidth: rest.screenshotMaxWidth ?? screenshot?.maxWidth ?? screenshot?.screenshotMaxWidth,
    screenshotMaxHeight: rest.screenshotMaxHeight ?? screenshot?.maxHeight ?? screenshot?.screenshotMaxHeight,
    screenshotResize: rest.screenshotResize ?? screenshot?.resize ?? screenshot?.screenshotResize,
    sendInitialScreenshot: rest.sendInitialScreenshot ?? screenshot?.sendInitialScreenshot,
    redactScreenshot: rest.redactScreenshot ?? screenshot?.redact ?? screenshot?.redactScreenshot,
    cwd: rest.cwd ?? commandOptions?.cwd,
    env: rest.env ?? commandOptions?.env,
    shell: rest.shell ?? commandOptions?.shell,
    timeoutMs: rest.timeoutMs ?? commandOptions?.timeoutMs ?? commandOptions?.timeout,
    approval: rest.approval ?? commandOptions?.approval,
    allowedCommands:
      rest.allowedCommands ?? commandOptions?.allow ?? commandOptions?.allowed ?? commandOptions?.allowedCommands,
    blockedCommands:
      rest.blockedCommands ?? commandOptions?.block ?? commandOptions?.blocked ?? commandOptions?.blockedCommands,
    confirmCommand: rest.confirmCommand ?? commandOptions?.confirm ?? commandOptions?.confirmCommand
  });
}

function cleanUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function unknownOptionMessage(scope, unknownKey, allowedKeys) {
  const suggestion = closestOption(unknownKey, [...allowedKeys]);
  return `Unknown ${scope} option ${JSON.stringify(unknownKey)}.${suggestion ? ` Did you mean ${JSON.stringify(suggestion)}?` : ""}`;
}

function closestOption(input, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(input.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return bestDistance <= Math.max(2, Math.floor(input.length / 3)) ? best : null;
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

export function summarizePayload(payload) {
  return {
    model: payload.model,
    previous_response_id: payload.previous_response_id,
    toolCount: payload.tools?.length ?? 0,
    inputCount: Array.isArray(payload.input) ? payload.input.length : undefined
  };
}

export function summarizeResponse(response) {
  return {
    id: response?.id,
    outputTypes: response?.output?.map((item) => item.type) ?? [],
    actions:
      response?.output?.flatMap((item) => {
        if (item?.type !== "computer_call") return [];
        const actions =
          Array.isArray(item.actions) && item.actions.length > 0 ? item.actions : [item.action].filter(Boolean);
        return actions.map((action) => describeAction(action)).filter(Boolean);
      }) ?? []
  };
}

function describeAction(action) {
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

function shortenId(value) {
  if (typeof value !== "string" || value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function previewText(value) {
  const compact = value.replace(/\s+/g, " ").trim();
  return JSON.stringify(compact.length > 120 ? `${compact.slice(0, 117)}...` : compact);
}
