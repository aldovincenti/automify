import { AutomifyError } from "./errors.js";

export class AutomifyTask {
  constructor(automify, options = {}) {
    if (!automify || typeof automify.do !== "function") {
      throw new AutomifyError("AutomifyTask requires an Automify runner.");
    }

    this.automify = automify;
    this.steps = [];
    this.runOptions = { ...options };
  }

  addStep(instruction, options = {}) {
    this.#add("step", instruction, options);
    return this;
  }

  step(instruction, options = {}) {
    return this.addStep(instruction, options);
  }

  addWait(conditionOrMs = "the current screen is ready", options = {}) {
    this.#add("wait", formatWaitInstruction(conditionOrMs), options);
    return this;
  }

  wait(conditionOrMs, options = {}) {
    return this.addWait(conditionOrMs, options);
  }

  addObserve(instruction, options = {}) {
    this.#add("observe", instruction, options);
    return this;
  }

  observe(instruction, options = {}) {
    return this.addObserve(instruction, options);
  }

  addExtract(instruction, options = {}) {
    this.#add("extract", instruction, options);
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
    this.runOptions = {
      ...this.runOptions,
      ...options,
      data:
        this.runOptions.data && options.data && isPlainObject(this.runOptions.data) && isPlainObject(options.data)
          ? { ...this.runOptions.data, ...options.data }
          : (options.data ?? this.runOptions.data)
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
    return this.automify.do(this.toInstruction(), mergeRunOptions(this.runOptions, options));
  }

  async do(options = {}) {
    return this.run(options);
  }

  #add(type, instruction, options = {}) {
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
      notes: typeof options.notes === "string" && options.notes.trim() ? options.notes.trim() : undefined
    });
  }
}

export function createTask(automify, options = {}) {
  return new AutomifyTask(automify, options);
}

function formatWaitInstruction(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `Wait for about ${Math.max(0, Math.round(value))} ms before continuing.`;
  }
  if (typeof value === "string" && value.trim()) {
    return `Wait until ${value.trim()}.`;
  }
  return "Wait until the current screen is ready.";
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

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
