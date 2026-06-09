import { setTimeout as delay } from "node:timers/promises";

import { AutomifyError } from "./errors.js";
import { jsonOutput } from "./output.js";
import { startScreenRecording } from "./screen-recording.js";

const DEFAULT_TASK_MODE = "single";
const ASSERTION_OUTPUT = jsonOutput("task_assertion", {
  passed: "boolean",
  reason: "string"
});

export class AutomifyTask {
  constructor(automify, options = {}) {
    if (!automify || typeof automify.do !== "function") {
      throw new AutomifyError("AutomifyTask requires an Automify runner.");
    }

    const taskOptions = normalizeTaskOptions(options);
    this.automify = automify;
    this.steps = [];
    this.mode = taskOptions.mode;
    this.runOptions = taskOptions.runOptions;
  }

  addStep(instruction, options = {}) {
    this.#add("step", instruction, options);
    return this;
  }

  addAct(instruction, options = {}) {
    return this.addStep(instruction, options);
  }

  act(instruction, options = {}) {
    return this.addAct(instruction, options);
  }

  step(instruction, options = {}) {
    return this.addStep(instruction, options);
  }

  addWait(conditionOrMs = "the current screen is ready", options = {}) {
    if (typeof conditionOrMs === "number") {
      return this.addPause(conditionOrMs, options);
    }
    this.#add("wait", formatWaitInstruction(conditionOrMs), options);
    return this;
  }

  addWaitFor(condition = "the current screen is ready", options = {}) {
    return this.addWait(condition, options);
  }

  waitFor(condition, options = {}) {
    return this.addWaitFor(condition, options);
  }

  wait(conditionOrMs, options = {}) {
    return this.addWait(conditionOrMs, options);
  }

  addPause(ms, options = {}) {
    const pauseMs = normalizePauseMs(ms);
    this.#add("pause", formatPauseInstruction(pauseMs), options, { pauseMs });
    return this;
  }

  pause(ms, options = {}) {
    return this.addPause(ms, options);
  }

  addObserve(instruction, options = {}) {
    this.#add("observe", instruction, options);
    return this;
  }

  observe(instruction, options = {}) {
    return this.addObserve(instruction, options);
  }

  addExtract(instruction, options = {}) {
    this.#add("extract", instruction, options, normalizeExtractOptions(options));
    return this;
  }

  extract(instruction, options = {}) {
    return this.addExtract(instruction, options);
  }

  addAssert(instruction, options = {}) {
    this.#add("assert", instruction, options);
    return this;
  }

  assert(instruction, options = {}) {
    return this.addAssert(instruction, options);
  }

  addData(data) {
    this.runOptions.data = {
      ...(isPlainObject(this.runOptions.data) ? this.runOptions.data : {}),
      ...(isPlainObject(data) ? data : { value: data })
    };
    return this;
  }

  withData(data) {
    this.runOptions.data = data;
    return this;
  }

  withOptions(options = {}) {
    if (!isPlainObject(options)) {
      throw new AutomifyError("task options must be an object.");
    }
    const taskOptions = normalizeTaskOptions(options, this.mode);
    this.mode = taskOptions.mode;
    this.runOptions = {
      ...this.runOptions,
      ...taskOptions.runOptions,
      data:
        this.runOptions.data &&
        taskOptions.runOptions.data &&
        isPlainObject(this.runOptions.data) &&
        isPlainObject(taskOptions.runOptions.data)
          ? { ...this.runOptions.data, ...taskOptions.runOptions.data }
          : (taskOptions.runOptions.data ?? this.runOptions.data)
    };
    return this;
  }

  toInstruction() {
    if (this.steps.length === 0) {
      throw new AutomifyError("task must include at least one step.");
    }

    return [
      "Follow these steps in order. Complete each step before starting the next one.",
      "",
      ...this.steps.map((step, index) => `${index + 1}. ${formatStep(step)}`)
    ].join("\n");
  }

  async run(options = {}) {
    const taskOptions = mergeTaskOptions(
      { mode: this.mode, runOptions: this.runOptions },
      normalizeTaskOptions(options, this.mode)
    );
    if (taskOptions.mode === "sequential") {
      return this.#runSequential(taskOptions.runOptions);
    }
    return this.automify.do(this.toInstruction(), applyExtractOutput(this.steps, taskOptions.runOptions));
  }

  async do(options = {}) {
    return this.run(options);
  }

  #add(type, instruction, options = {}, meta = {}) {
    if (typeof instruction !== "string" || instruction.trim() === "") {
      throw new AutomifyError(`${type} instruction must be a non-empty string.`);
    }
    if (!isPlainObject(options)) {
      throw new AutomifyError(`${type} options must be an object.`);
    }

    this.steps.push({
      type,
      instruction: instruction.trim(),
      label: typeof options.label === "string" && options.label.trim() ? options.label.trim() : undefined,
      notes: typeof options.notes === "string" && options.notes.trim() ? options.notes.trim() : undefined,
      ...meta
    });
  }

  async #runSequential(runOptions) {
    assertHasSteps(this.steps);
    assertSequentialExtracts(this.steps, runOptions);

    const taskSteps = [];
    const modelSteps = [];
    const extracts = {};
    let directParsed;
    let lastResult = null;
    let recording = null;

    try {
      recording = await this.#startSequentialRecording(runOptions);
      const childBaseOptions = recording ? suppressChildRecording(runOptions) : runOptions;
      const finalModelStepIndex = findFinalModelStepIndex(this.steps);

      for (let index = 0; index < this.steps.length; index += 1) {
        const step = this.steps[index];
        const startedAt = Date.now();

        if (step.type === "pause") {
          await delay(step.pauseMs);
          taskSteps.push(
            taskStepRecord(step, index, {
              status: "succeeded",
              durationMs: Date.now() - startedAt
            })
          );
          continue;
        }

        const output = outputForSequentialStep(step, runOptions, index === finalModelStepIndex);
        const stepRunOptions = output ? { ...childBaseOptions, output } : withoutOutput(childBaseOptions);
        let result;
        try {
          result = await this.automify.do(
            formatSequentialStepInstruction(step, index, this.steps.length),
            stepRunOptions
          );
        } catch (error) {
          error.taskSteps = [
            ...taskSteps,
            taskStepRecord(step, index, {
              status: "failed",
              durationMs: Date.now() - startedAt,
              error: error.message
            })
          ];
          throw error;
        }
        lastResult = result;
        if (Array.isArray(result.steps)) modelSteps.push(...result.steps);

        if (step.type === "assert") {
          const assertion = normalizeAssertionResult(result.parsed);
          if (assertion.passed !== true) {
            const error = new AutomifyError(`task assertion failed: ${assertion.reason || step.instruction}`);
            error.taskSteps = [
              ...taskSteps,
              taskStepRecord(step, index, {
                status: "failed",
                durationMs: Date.now() - startedAt,
                responseId: result.response?.id,
                text: result.text,
                parsed: result.parsed,
                modelSteps: Array.isArray(result.steps) ? result.steps.length : 0,
                error: assertion.reason || step.instruction
              })
            ];
            throw error;
          }
        }

        if (step.extract && "parsed" in result) {
          if (step.extract.key) {
            extracts[step.extract.key] = result.parsed;
          } else {
            directParsed = result.parsed;
          }
        }

        taskSteps.push(
          taskStepRecord(step, index, {
            status: "succeeded",
            durationMs: Date.now() - startedAt,
            responseId: result.response?.id,
            text: result.text,
            parsed: result.parsed,
            modelSteps: Array.isArray(result.steps) ? result.steps.length : 0
          })
        );
      }

      const result = buildSequentialResult(lastResult, taskSteps, modelSteps, extracts, directParsed);
      if (recording) {
        const recordingResult = await recording.stop({ response: result.response, steps: modelSteps });
        if (recordingResult) result.recording = recordingResult;
      }
      return result;
    } catch (error) {
      if (recording) {
        await recording.stop({ force: true }).catch(() => {});
      }
      throw error;
    }
  }

  async #startSequentialRecording(runOptions) {
    const recordingInput = screenRecordingInputForTask(runOptions, this.automify);
    if (!recordingInput || typeof this.automify.computer?.screenshot !== "function") return null;

    return startScreenRecording(recordingInput, {
      instruction: this.toInstruction(),
      data: runOptions.data,
      captureFrame: (context) => this.automify.computer.screenshot(context)
    });
  }
}

export function createTask(automify, options = {}) {
  return new AutomifyTask(automify, options);
}

function formatWaitInstruction(value) {
  if (typeof value === "string" && value.trim()) {
    return `Wait until ${value.trim()}.`;
  }
  return "Wait until the current screen is ready.";
}

function normalizePauseMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) {
    throw new AutomifyError("pause duration must be a finite number of milliseconds.");
  }
  return Math.max(0, Math.round(ms));
}

function formatPauseInstruction(value) {
  return `Wait for about ${normalizePauseMs(value)} ms before continuing.`;
}

function formatStep(step) {
  const prefix = step.type === "step" ? "" : `${step.type}: `;
  const label = step.label ? `[${step.label}] ` : "";
  const notes = step.notes ? ` Notes: ${step.notes}` : "";
  return `${label}${prefix}${step.instruction}${notes}`;
}

function mergeRunOptions(base, override) {
  if (!isPlainObject(override) || Object.keys(override).length === 0) return base;
  return {
    ...base,
    ...override,
    data:
      base.data && override.data && isPlainObject(base.data) && isPlainObject(override.data)
        ? { ...base.data, ...override.data }
        : (override.data ?? base.data)
  };
}

function normalizeTaskOptions(options, fallbackMode = DEFAULT_TASK_MODE) {
  if (!isPlainObject(options)) {
    throw new AutomifyError("task options must be an object.");
  }

  const { mode = fallbackMode, ...runOptions } = options;
  return {
    mode: normalizeTaskMode(mode),
    runOptions
  };
}

function normalizeTaskMode(mode) {
  if (mode == null) return DEFAULT_TASK_MODE;
  if (mode === "single" || mode === "sequential") return mode;
  throw new AutomifyError('task mode must be "single" or "sequential".');
}

function mergeTaskOptions(base, override) {
  return {
    mode: override.mode ?? base.mode,
    runOptions: mergeRunOptions(base.runOptions, override.runOptions)
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeExtractOptions(options) {
  const output = outputFromExtractOptions(options);
  if (!output) return {};

  const key = typeof options.key === "string" && options.key.trim() ? options.key.trim() : undefined;
  return {
    extract: {
      key,
      output
    }
  };
}

function outputFromExtractOptions(options) {
  if (isOutputFormat(options)) return options;
  if (!isPlainObject(options)) return null;
  if (isOutputFormat(options.output)) return options.output;

  const shape = options.shape ?? options.schema;
  if (shape == null) return null;

  const key = typeof options.key === "string" && options.key.trim() ? options.key.trim() : undefined;
  if (!key) {
    throw new AutomifyError("extract shape options require a non-empty key.");
  }

  return jsonOutput(key, shape, {
    description: options.description,
    strict: options.strict,
    parse: options.parse
  });
}

function applyExtractOutput(steps, runOptions) {
  const extracts = steps.map((step) => step.extract).filter(Boolean);
  if (extracts.length === 0) return runOptions;

  if (runOptions.output) {
    throw new AutomifyError(
      "task extract outputs cannot be combined with run output. Put the output on extract steps."
    );
  }

  return {
    ...runOptions,
    output: outputForExtracts(extracts)
  };
}

function assertHasSteps(steps) {
  if (steps.length === 0) {
    throw new AutomifyError("task must include at least one step.");
  }
}

function assertSequentialExtracts(steps, runOptions) {
  const extracts = steps.map((step) => step.extract).filter(Boolean);
  if (extracts.length === 0) return;

  if (runOptions.output) {
    throw new AutomifyError(
      "task extract outputs cannot be combined with run output. Put the output on extract steps."
    );
  }

  if (extracts.length > 1) {
    for (const extract of extracts) {
      if (!extract.key) {
        throw new AutomifyError("multiple task extract outputs require a key for each extract.");
      }
    }
  }

  const keys = new Set();
  for (const extract of extracts) {
    if (!extract.key) continue;
    if (keys.has(extract.key)) {
      throw new AutomifyError(`duplicate task extract key: ${extract.key}`);
    }
    keys.add(extract.key);
  }
}

function findFinalModelStepIndex(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].type !== "pause") return index;
  }
  return -1;
}

function outputForSequentialStep(step, runOptions, isFinalModelStep) {
  if (step.type === "assert") return ASSERTION_OUTPUT;
  if (step.extract) return step.extract.output;
  if (isFinalModelStep) return runOptions.output;
  return undefined;
}

function withoutOutput(options) {
  if (!options.output) return options;
  const { output, ...rest } = options;
  return rest;
}

function suppressChildRecording(options) {
  return { ...options, screenRecording: false };
}

function screenRecordingInputForTask(runOptions, automify) {
  if (Object.hasOwn(runOptions, "screenRecording")) return runOptions.screenRecording;
  if (Object.hasOwn(runOptions, "recording")) return runOptions.recording;
  if (isPlainObject(runOptions.screenshots) && Object.hasOwn(runOptions.screenshots, "recording")) {
    return runOptions.screenshots.recording;
  }
  return automify.screenRecording;
}

function formatSequentialStepInstruction(step, index, total) {
  return [`Complete task step ${index + 1} of ${total}.`, "Do only this step, then stop.", "", formatStep(step)].join(
    "\n"
  );
}

function normalizeAssertionResult(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { passed: false, reason: "assertion result was not structured" };
  }
  return {
    passed: parsed.passed === true,
    reason: typeof parsed.reason === "string" ? parsed.reason : ""
  };
}

function taskStepRecord(step, index, details = {}) {
  return removeUndefined({
    index,
    type: step.type,
    instruction: step.instruction,
    label: step.label,
    notes: step.notes,
    ...details
  });
}

function buildSequentialResult(lastResult, taskSteps, modelSteps, extracts, directParsed) {
  const result = lastResult
    ? { ...lastResult }
    : {
        response: { id: null, output: [] },
        ok: true,
        status: "succeeded",
        completed: true,
        stopReason: "done",
        text: ""
      };

  result.steps = modelSteps;
  result.taskSteps = taskSteps;

  const extractKeys = Object.keys(extracts);
  if (extractKeys.length > 0) {
    result.extracts = extracts;
    result.parsed = extracts;
  } else if (directParsed !== undefined) {
    result.parsed = directParsed;
  }

  return result;
}

function removeUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function outputForExtracts(extracts) {
  if (extracts.length === 1 && !extracts[0].key) {
    return extracts[0].output;
  }

  const properties = {};
  for (const extract of extracts) {
    if (!extract.key) {
      throw new AutomifyError("multiple task extract outputs require a key for each extract.");
    }
    if (properties[extract.key]) {
      throw new AutomifyError(`duplicate task extract key: ${extract.key}`);
    }
    if (extract.output.type !== "json_schema" || !isPlainObject(extract.output.schema)) {
      throw new AutomifyError("keyed task extract outputs require json_schema output.");
    }
    properties[extract.key] = extract.output.schema;
  }

  return jsonOutput("task_extracts", properties);
}

function isOutputFormat(value) {
  return Boolean(value && typeof value === "object" && typeof value.type === "string");
}
