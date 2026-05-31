import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { AutomifyError, MaxStepsExceededError, SafetyCheckError } from "./errors.js";
import { OpenAIResponsesClient } from "./openai-responses-client.js";
import { toDataUrl } from "./adapter-toolkit.js";
import { filesToEvaluate } from "./file-data.js";
import { buildRunResult, buildTextConfig } from "./result.js";
import {
  callHook,
  debugLog,
  mergeRequestOptions,
  normalizeAutomifyOptions,
  normalizeDoArguments,
  summarizePayload,
  summarizeResponse,
  writeDebugLogFile
} from "./runtime.js";

const DEFAULT_MAX_STEPS = 1000;
const DEFAULT_SCREENSHOT_DETAIL = "auto";
const DEFAULT_SCREENSHOT_MAX_WIDTH = 1440;
const DEFAULT_SCREENSHOT_MAX_HEIGHT = 1440;

export { AutomifyError, MaxStepsExceededError, SafetyCheckError };

export function createAutomify(options) {
  return new Automify(options);
}

export class Automify {
  constructor(options = {}) {
    const {
      openaiApiKey,
      client,
      computer,
      model,
      baseURL,
      fetchImpl,
      maxSteps = DEFAULT_MAX_STEPS,
      requestOptions,
      displayWidth,
      displayHeight,
      environment,
      reasoning,
      safetyIdentifier,
      allowedDomains,
      onStep,
      onRequest,
      onResponse,
      onComplete,
      redactScreenshot,
      screenshotDetail,
      screenshotMaxWidth = DEFAULT_SCREENSHOT_MAX_WIDTH,
      screenshotMaxHeight = DEFAULT_SCREENSHOT_MAX_HEIGHT,
      screenshotResize,
      sendInitialScreenshot,
      initialScreenshot,
      finalScreenshot,
      actionScreenshots,
      trace,
      silent,
      debug,
      logFile
    } = normalizeAutomifyOptions(options);
    this.client = client ?? new OpenAIResponsesClient({ openaiApiKey, baseURL, fetchImpl });
    this.computer = computer;
    this.model = model;
    this.maxSteps = maxSteps;
    this.requestOptions = requestOptions;
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
    this.environment = environment;
    this.reasoning = reasoning;
    this.safetyIdentifier = safetyIdentifier;
    this.allowedDomains = allowedDomains;
    this.onStep = onStep;
    this.onRequest = onRequest;
    this.onResponse = onResponse;
    this.onComplete = onComplete;
    this.redactScreenshot = redactScreenshot;
    this.screenshotDetail = screenshotDetail;
    this.screenshotMaxWidth = screenshotMaxWidth;
    this.screenshotMaxHeight = screenshotMaxHeight;
    this.screenshotResize = screenshotResize;
    this.sendInitialScreenshot = sendInitialScreenshot;
    this.initialScreenshot = initialScreenshot;
    this.finalScreenshot = finalScreenshot;
    this.actionScreenshots = actionScreenshots;
    this.trace = trace;
    this.silent = silent;
    this.debug = debug;
    this.logFile = logFile;

    assertComputer(computer);
  }

  async do(instruction, runOptions = {}, maybeOptions) {
    if (typeof instruction !== "string" || instruction.trim() === "") {
      throw new AutomifyError("instruction must be a non-empty string.");
    }

    const { data, options } = normalizeDoArguments(runOptions, maybeOptions);
    const previousSilent = this.silent;
    if ("silent" in options) this.silent = options.silent;

    try {
      const maxSteps = options.maxSteps ?? this.maxSteps;
      const model = assertModel(options.model ?? this.model);
      const tools = [this.#computerTool(options)];
      const steps = [];
      const traceEnabled = options.trace ?? this.trace;
      const traceEvents = [];
      const trace = (event) => {
        if (traceEnabled) {
          traceEvents.push({ at: new Date().toISOString(), ...event });
        }
      };

      const initialScreenshotPath = initialScreenshotPathFor(options, this);
      const finalScreenshotPath = finalScreenshotPathFor(options, this);
      const actionScreenshotsPath = actionScreenshotsPathFor(options, this);
      this.#debug("run_start", {
        model,
        maxSteps,
        initialScreenshot: initialScreenshotPath ?? null,
        finalScreenshot: finalScreenshotPath ?? null,
        actionScreenshots: actionScreenshotsPath ?? null,
        screenshotDetail: screenshotDetailFor(options, this),
        screenshotMaxWidth: screenshotMaxWidthFor(options, this),
        screenshotMaxHeight: screenshotMaxHeightFor(options, this)
      });
      trace({
        type: "run_start",
        model,
        maxSteps,
        initialScreenshot: initialScreenshotPath ?? null,
        finalScreenshot: finalScreenshotPath ?? null,
        actionScreenshots: actionScreenshotsPath ?? null,
        screenshotDetail: screenshotDetailFor(options, this)
      });

      await this.#assertAllowedCurrentUrl(options);

      const initial = await this.#initialInput(
        instruction,
        data,
        {
          ...options,
          allowedDomains: options.allowedDomains ?? this.allowedDomains
        },
        trace
      );
      let actionCoordinateTransform = initial.actionCoordinateTransform;
      let lastPreparedScreenshot = initial.preparedScreenshot;
      let response = await this.#createResponse(
        mergeRequestOptions(options.requestOptions ?? this.requestOptions, {
          model,
          tools,
          input: initial.input,
          text: buildTextConfig(options.output),
          reasoning: options.reasoning ?? this.reasoning ?? { summary: "concise" },
          safety_identifier: options.safetyIdentifier ?? this.safetyIdentifier,
          truncation: "auto"
        }),
        { phase: "initial", surface: "computer", requestOptions: options.requestOptions ?? this.requestOptions, trace }
      );

      for (let step = 0; step < maxSteps; step += 1) {
        const computerCall = findComputerCall(response);

        if (!computerCall) {
          const result = buildRunResult(response, steps, options.output);
          const finalScreenshot = await this.#saveFinalScreenshot({ response, steps }, options, trace);
          if (finalScreenshot) result.finalScreenshot = finalScreenshot;
          if (traceEnabled) result.trace = traceEvents;
          await this.#complete(result, { instruction, data }, options);
          return result;
        }

        await this.#handleSafetyChecks(computerCall, response, options);

        const actions = getComputerActions(computerCall);
        await this.#emitStep(
          {
            index: step,
            phase: "before_action",
            action: actions[0],
            actions,
            call: computerCall,
            response
          },
          options
        );
        const executedActions = [];
        const actionScreenshots = [];
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          const action = actions[actionIndex];
          const executableAction = scaleComputerAction(action, actionCoordinateTransform);
          executedActions.push(executableAction);
          const beforeScreenshot = await this.#saveActionScreenshot(
            {
              step,
              actionIndex,
              phase: "before",
              action,
              executableAction,
              call: computerCall,
              response
            },
            options,
            trace
          );
          const actionStartedAt = Date.now();
          await this.computer.execute(executableAction, {
            call: computerCall,
            response,
            step,
            actionIndex
          });
          const durationMs = Date.now() - actionStartedAt;
          const afterScreenshot = await this.#saveActionScreenshot(
            {
              step,
              actionIndex,
              phase: "after",
              action,
              executableAction,
              call: computerCall,
              response,
              durationMs
            },
            options,
            trace
          );
          if (beforeScreenshot || afterScreenshot) {
            actionScreenshots.push({
              actionIndex,
              action,
              executableAction,
              before: beforeScreenshot,
              after: afterScreenshot
            });
          }
          this.#debug("action_executed", {
            step,
            actionIndex,
            action,
            executableAction,
            coordinateTransform: actionCoordinateTransform,
            durationMs
          });
          trace({
            type: "action",
            step,
            actionIndex,
            action,
            executableAction,
            coordinateTransform: actionCoordinateTransform,
            durationMs
          });
        }
        await this.#assertAllowedCurrentUrl(options);

        const screenshotStartedAt = Date.now();
        const preparedScreenshot = canReuseLastScreenshot(actions, lastPreparedScreenshot)
          ? {
              ...lastPreparedScreenshot,
              meta: {
                ...lastPreparedScreenshot.meta,
                reused: true
              }
            }
          : await this.#capturePreparedScreenshot(
              {
                call: computerCall,
                response,
                step
              },
              options
            );
        lastPreparedScreenshot = preparedScreenshot;
        actionCoordinateTransform = preparedScreenshot.actionCoordinateTransform;
        const screenshotDurationMs = Date.now() - screenshotStartedAt;
        this.#debug("screenshot", {
          step,
          phase: "after_action",
          ...preparedScreenshot.meta,
          detail: screenshotDetailFor(options, this),
          durationMs: screenshotDurationMs
        });
        trace({
          type: "screenshot",
          step,
          phase: "after_action",
          ...preparedScreenshot.meta,
          detail: screenshotDetailFor(options, this),
          durationMs: screenshotDurationMs
        });

        const currentUrl = await getCurrentUrl(this.computer);
        const input = {
          type: "computer_call_output",
          call_id: computerCall.call_id,
          output: {
            type: "computer_screenshot",
            image_url: toDataUrl(preparedScreenshot.screenshot),
            detail: screenshotDetailFor(options, this)
          }
        };

        if (computerCall.pending_safety_checks?.length) {
          input.acknowledged_safety_checks = computerCall.pending_safety_checks;
        }

        steps.push({
          index: step,
          action: actions[0],
          actions,
          executedActions,
          actionScreenshots,
          callId: computerCall.call_id,
          safetyChecks: computerCall.pending_safety_checks ?? [],
          responseId: response.id
        });
        await this.#emitStep(
          {
            index: step,
            phase: "after_action",
            action: actions[0],
            actions,
            call: computerCall,
            response,
            currentUrl
          },
          options
        );

        response = await this.#createResponse(
          mergeRequestOptions(options.requestOptions ?? this.requestOptions, {
            model,
            previous_response_id: response.id,
            tools,
            input: [input],
            text: buildTextConfig(options.output),
            truncation: "auto"
          }),
          {
            phase: "continue",
            surface: "computer",
            step,
            requestOptions: options.requestOptions ?? this.requestOptions,
            trace
          }
        );
      }

      throw new MaxStepsExceededError(maxSteps);
    } finally {
      this.silent = previousSilent;
    }
  }

  async #initialInput(instruction, data, options, trace) {
    const content = [{ type: "input_text", text: formatInstruction(instruction, data, this.computer, options) }];
    content.push(...(await evaluationContentFor(options.filesToEvaluate)));
    let actionCoordinateTransform = null;
    let preparedScreenshot = null;

    const path = initialScreenshotPathFor(options, this);
    if (path || sendInitialScreenshotFor(options, this)) {
      const startedAt = Date.now();
      const rawScreenshot = await this.#captureRawScreenshot({ initial: true }, options);
      const writtenBytes = path ? await writeScreenshotFile(path, rawScreenshot) : null;
      preparedScreenshot = await prepareScreenshot(rawScreenshot, options, this);
      actionCoordinateTransform = preparedScreenshot.actionCoordinateTransform;
      const durationMs = Date.now() - startedAt;
      this.#debug("screenshot", {
        phase: "initial",
        path: path ?? null,
        writtenBytes,
        ...preparedScreenshot.meta,
        detail: screenshotDetailFor(options, this),
        durationMs
      });
      trace?.({
        type: "screenshot",
        phase: "initial",
        path: path ?? null,
        writtenBytes,
        ...preparedScreenshot.meta,
        detail: screenshotDetailFor(options, this),
        durationMs
      });
      content.push({
        type: "input_image",
        image_url: toDataUrl(preparedScreenshot.screenshot),
        detail: screenshotDetailFor(options, this)
      });
    }

    return {
      input: [{ role: "user", content }],
      actionCoordinateTransform,
      preparedScreenshot
    };
  }

  async #capturePreparedScreenshot(context, options) {
    let screenshot = await this.computer.screenshot(context);
    screenshot = await this.#redactScreenshot(screenshot, context, options);
    return prepareScreenshot(screenshot, options, this);
  }

  async #saveFinalScreenshot(context, options, trace) {
    const path = finalScreenshotPathFor(options, this);
    if (!path) return null;

    const startedAt = Date.now();
    const screenshot = await this.#captureRawScreenshot(
      {
        ...context,
        final: true
      },
      options
    );
    const bytes = await writeScreenshotFile(path, screenshot);
    const durationMs = Date.now() - startedAt;

    this.#debug("screenshot", {
      phase: "final",
      path,
      bytes,
      durationMs
    });
    trace?.({
      type: "screenshot",
      phase: "final",
      path,
      bytes,
      durationMs
    });

    return {
      path,
      bytes
    };
  }

  async #saveActionScreenshot(context, options, trace) {
    const directory = actionScreenshotsPathFor(options, this);
    if (!directory) return null;

    const startedAt = Date.now();
    const path = actionScreenshotFilePath(directory, context);
    const screenshot = await this.#captureRawScreenshot(
      {
        ...context,
        actionScreenshot: true
      },
      options
    );
    const bytes = await writeScreenshotFile(path, screenshot);
    const durationMs = Date.now() - startedAt;

    this.#debug("screenshot", {
      phase: `action_${context.phase}`,
      step: context.step,
      actionIndex: context.actionIndex,
      action: context.action,
      path,
      bytes,
      durationMs
    });
    trace?.({
      type: "screenshot",
      phase: `action_${context.phase}`,
      step: context.step,
      actionIndex: context.actionIndex,
      action: context.action,
      path,
      bytes,
      durationMs
    });

    return {
      path,
      bytes
    };
  }

  async #captureRawScreenshot(context, options) {
    let screenshot = await this.computer.screenshot(context);
    return this.#redactScreenshot(screenshot, context, options);
  }

  #computerTool(options) {
    return cleanUndefined({
      type: "computer",
      environment: options.environment ?? this.environment ?? this.computer.environment,
      displayWidth: options.displayWidth ?? this.displayWidth ?? this.computer.displayWidth,
      displayHeight: options.displayHeight ?? this.displayHeight ?? this.computer.displayHeight
    });
  }

  async #handleSafetyChecks(computerCall, response, options) {
    const checks = computerCall.pending_safety_checks ?? [];
    if (checks.length === 0) return;

    if (typeof options.onSafetyCheck !== "function") {
      throw new SafetyCheckError(checks, computerCall.action);
    }

    const acknowledged = await options.onSafetyCheck({
      checks,
      action: computerCall.action,
      call: computerCall,
      response
    });

    if (!acknowledged) {
      throw new SafetyCheckError(checks, computerCall.action);
    }
  }

  async #createResponse(payload, meta) {
    const { trace, ...publicMeta } = meta;
    await callHook(this.onRequest, payload, publicMeta);
    this.#debug("request", { meta: publicMeta, payload: summarizePayload(payload) });
    const startedAt = Date.now();
    const response = await this.client.createResponse(payload, publicMeta);
    const durationMs = Date.now() - startedAt;
    await callHook(this.onResponse, response, publicMeta);
    this.#debug("response", { meta: publicMeta, durationMs, response: summarizeResponse(response) });
    trace?.({
      type: "response",
      phase: publicMeta.phase,
      step: publicMeta.step,
      responseId: response?.id,
      durationMs
    });
    return response;
  }

  async #emitStep(event, options) {
    await callHook(this.onStep, event);
    await callHook(options.onStep, event);
    this.#debug("step", event);
  }

  async #complete(result, context, options) {
    const event = {
      instruction: context.instruction,
      data: context.data,
      result,
      response: result.response,
      steps: result.steps,
      ok: result.ok,
      status: result.status,
      completed: result.completed,
      stopReason: result.stopReason,
      surface: surfaceFromComputer(this.computer)
    };

    await callHook(this.onComplete, event);
    await callHook(options.onComplete, event);
    this.#debug("complete", event);
  }

  async #redactScreenshot(screenshot, context, options) {
    const redactor = options.redactScreenshot ?? this.redactScreenshot;
    if (typeof redactor !== "function") return screenshot;
    return redactor(screenshot, context);
  }

  async #assertAllowedCurrentUrl(options) {
    const allowedDomains = options.allowedDomains ?? this.allowedDomains;
    if (!allowedDomains?.length || typeof this.computer.currentUrl !== "function") return;

    const currentUrl = await this.computer.currentUrl();
    if (!currentUrl || !isAllowedUrl(currentUrl, allowedDomains)) {
      throw new AutomifyError(`Current URL is not allowed: ${currentUrl ?? "unknown"}`);
    }
  }

  #debug(message, details) {
    writeDebugLogFile(this.logFile, "automify", message, details, { silent: this.silent });
    debugLog(this.debug, "automify", message, details, { silent: this.silent });
  }
}

function assertComputer(computer) {
  if (!computer || typeof computer !== "object") {
    throw new AutomifyError("A computer adapter is required.");
  }

  if (typeof computer.execute !== "function") {
    throw new AutomifyError("The computer adapter must provide execute(action, context).");
  }

  if (typeof computer.screenshot !== "function") {
    throw new AutomifyError("The computer adapter must provide screenshot(context).");
  }
}

function cleanUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function formatInstruction(instruction, data, computer, options = {}) {
  const guidance = [computer?.instructions, options.instructions, domainPolicyGuidance(options.allowedDomains)]
    .filter((item) => typeof item === "string" && item.trim() !== "")
    .join("\n\n");
  const baseInstruction = guidance ? `${guidance}\n\nTask:\n${instruction}` : instruction;

  if (data == null || (typeof data === "object" && Object.keys(data).length === 0)) {
    return baseInstruction;
  }

  return `${baseInstruction}\n\nData:\n${JSON.stringify(data, null, 2)}`;
}

function domainPolicyGuidance(allowedDomains) {
  const domains = domainRulesGuidance(allowedDomains);
  if (!domains) return "";
  return `Navigation policy:\nStay within these allowed domains: ${domains}. Do not navigate to other domains.`;
}

function domainRulesGuidance(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return "";
  return rules.map(domainRuleGuidance).join(", ");
}

function domainRuleGuidance(rule) {
  if (rule instanceof RegExp) return rule.toString();
  if (typeof rule === "function") return "[custom domain rule]";
  const value = String(rule);
  return `${JSON.stringify(value)} (domain and subdomains)`;
}

async function evaluationContentFor(files) {
  if (files == null) return [];
  return filesToEvaluate(files);
}

function assertModel(model) {
  if (typeof model !== "string" || model.trim() === "") {
    throw new AutomifyError("A model is required. Pass model to initAutomify(), the surface factory, or do().");
  }

  return model;
}

async function prepareScreenshot(screenshot, options, automify) {
  const originalBytes = byteLength(screenshot);
  const originalDimensions = pngDimensions(screenshot);
  const maxWidth = screenshotMaxWidthFor(options, automify);
  const maxHeight = screenshotMaxHeightFor(options, automify);
  const target = fitDimensions(originalDimensions, maxWidth, maxHeight);

  if (!target || (target.width === originalDimensions.width && target.height === originalDimensions.height)) {
    return {
      screenshot,
      actionCoordinateTransform: coordinateTransform(originalDimensions, originalDimensions),
      meta: {
        originalBytes,
        bytes: originalBytes,
        originalWidth: originalDimensions?.width,
        originalHeight: originalDimensions?.height,
        width: originalDimensions?.width,
        height: originalDimensions?.height,
        resized: false
      }
    };
  }

  const resized = await resizeScreenshot(screenshot, target, options, automify);
  if (!resized) {
    return {
      screenshot,
      actionCoordinateTransform: coordinateTransform(originalDimensions, originalDimensions),
      meta: {
        originalBytes,
        bytes: originalBytes,
        originalWidth: originalDimensions.width,
        originalHeight: originalDimensions.height,
        width: originalDimensions.width,
        height: originalDimensions.height,
        resized: false,
        resizeSkipped: true
      }
    };
  }

  const resizedDimensions = pngDimensions(resized) ?? target;
  return {
    screenshot: resized,
    actionCoordinateTransform: coordinateTransform(originalDimensions, resizedDimensions),
    meta: {
      originalBytes,
      bytes: byteLength(resized),
      originalWidth: originalDimensions.width,
      originalHeight: originalDimensions.height,
      width: resizedDimensions.width,
      height: resizedDimensions.height,
      resized: true
    }
  };
}

async function resizeScreenshot(screenshot, target, options, automify) {
  const customResize = options.screenshotResize ?? automify.screenshotResize;
  if (typeof customResize === "function") {
    return customResize(screenshot, target);
  }

  try {
    const { Jimp, JimpMime } = await import("jimp");
    const image = await Jimp.read(Buffer.from(screenshot));
    image.resize({ w: target.width, h: target.height });
    return image.getBuffer(JimpMime.png);
  } catch (error) {
    debugLog(automify.debug, "automify", "screenshot_resize_skipped", {
      reason: error?.message,
      target
    });
    return null;
  }
}

function fitDimensions(dimensions, maxWidth, maxHeight) {
  if (!dimensions?.width || !dimensions?.height) return null;
  const widthLimit = positiveNumber(maxWidth);
  const heightLimit = positiveNumber(maxHeight);
  if (!widthLimit && !heightLimit) return null;

  const scale = Math.min(
    widthLimit ? widthLimit / dimensions.width : 1,
    heightLimit ? heightLimit / dimensions.height : 1,
    1
  );
  if (scale >= 1) return dimensions;

  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale))
  };
}

function coordinateTransform(originalDimensions, modelDimensions) {
  if (
    !originalDimensions?.width ||
    !originalDimensions?.height ||
    !modelDimensions?.width ||
    !modelDimensions?.height
  ) {
    return null;
  }

  return {
    scaleX: originalDimensions.width / modelDimensions.width,
    scaleY: originalDimensions.height / modelDimensions.height,
    modelWidth: modelDimensions.width,
    modelHeight: modelDimensions.height,
    computerWidth: originalDimensions.width,
    computerHeight: originalDimensions.height
  };
}

function scaleComputerAction(action, transform) {
  if (!transform || (transform.scaleX === 1 && transform.scaleY === 1)) return action;

  const scaled = { ...action };
  if ("x" in scaled) scaled.x = scaleCoordinate(scaled.x, transform.scaleX);
  if ("y" in scaled) scaled.y = scaleCoordinate(scaled.y, transform.scaleY);
  if (Array.isArray(scaled.path)) {
    scaled.path = scaled.path.map((point) => ({
      ...point,
      x: scaleCoordinate(point.x, transform.scaleX),
      y: scaleCoordinate(point.y, transform.scaleY)
    }));
  }
  return scaled;
}

function scaleCoordinate(value, scale) {
  return Math.round((Number(value) || 0) * scale);
}

function canReuseLastScreenshot(actions, lastPreparedScreenshot) {
  return Boolean(
    lastPreparedScreenshot && actions.length > 0 && actions.every((action) => action?.type === "screenshot")
  );
}

function screenshotDetailFor(options, automify) {
  return options.screenshotDetail ?? automify.screenshotDetail ?? DEFAULT_SCREENSHOT_DETAIL;
}

function sendInitialScreenshotFor(options, automify) {
  return options.sendInitialScreenshot ?? automify.sendInitialScreenshot ?? false;
}

function initialScreenshotPathFor(options, automify) {
  return resolveScreenshotPath(options.initialScreenshot ?? automify.initialScreenshot);
}

function finalScreenshotPathFor(options, automify) {
  return resolveScreenshotPath(options.finalScreenshot ?? automify.finalScreenshot);
}

function actionScreenshotsPathFor(options, automify) {
  return resolveScreenshotPath(options.actionScreenshots ?? automify.actionScreenshots);
}

function resolveScreenshotPath(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function actionScreenshotFilePath(directory, { step, actionIndex, phase, action }) {
  const actionType = sanitizePathSegment(action?.type ?? "action");
  return join(directory, `step-${padNumber(step)}-action-${padNumber(actionIndex)}-${phase}-${actionType}.png`);
}

function padNumber(value) {
  return String(value).padStart(4, "0");
}

function sanitizePathSegment(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "action"
  );
}

async function writeScreenshotFile(path, screenshot) {
  const buffer = screenshotToBuffer(screenshot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
  return buffer.byteLength;
}

function screenshotMaxWidthFor(options, automify) {
  return options.screenshotMaxWidth ?? automify.screenshotMaxWidth ?? DEFAULT_SCREENSHOT_MAX_WIDTH;
}

function screenshotMaxHeightFor(options, automify) {
  return options.screenshotMaxHeight ?? automify.screenshotMaxHeight ?? DEFAULT_SCREENSHOT_MAX_HEIGHT;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function pngDimensions(value) {
  const buffer = Buffer.from(value);
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

function byteLength(value) {
  if (typeof value === "string") return Buffer.byteLength(value);
  if (Buffer.isBuffer(value)) return value.byteLength;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value.byteLength;
  return undefined;
}

function screenshotToBuffer(value) {
  if (typeof value === "string") {
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/s.exec(value);
    return Buffer.from(dataUrlMatch ? dataUrlMatch[1] : value, dataUrlMatch ? "base64" : "utf8");
  }

  return Buffer.from(value);
}

function findComputerCall(response) {
  return response?.output?.find((item) => item.type === "computer_call") ?? null;
}

function getComputerActions(computerCall) {
  if (Array.isArray(computerCall.actions) && computerCall.actions.length > 0) {
    return computerCall.actions;
  }

  if (computerCall.action) {
    return [computerCall.action];
  }

  return [{ type: "screenshot" }];
}

async function getCurrentUrl(computer) {
  if (typeof computer.currentUrl !== "function") return null;
  return computer.currentUrl();
}

function surfaceFromComputer(computer) {
  if (computer?.environment === "browser") return "browser";
  if (["mac", "windows", "ubuntu", "linux"].includes(computer?.environment)) return "desktop";
  return computer?.environment ?? "computer";
}

function isAllowedUrl(url, allowedDomains) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return allowedDomains.some((domain) => {
    if (domain instanceof RegExp) return domain.test(parsed.hostname);
    if (typeof domain === "function") return domain(parsed);
    const normalized = String(domain).toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}
