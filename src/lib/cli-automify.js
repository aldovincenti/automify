import { spawn } from "node:child_process";
import { AutomifyError, MaxStepsExceededError } from "./errors.js";
import { OpenAIResponsesClient } from "./openai-responses-client.js";
import { filesToEvaluate } from "./file-data.js";
import { applyCliPreset } from "./presets.js";
import { buildRunResult, buildTextConfig } from "./result.js";
import {
  AUTOMIFY_OPTION_KEYS,
  COMMAND_OPTION_KEYS,
  assertKnownOptions,
  callHook,
  debugLog,
  mergeOptionKeys,
  mergeRequestOptions,
  normalizeLogFile,
  normalizeDoArguments,
  summarizePayload,
  summarizeResponse,
  writeDebugLogFile
} from "./runtime.js";

const DEFAULT_MAX_STEPS = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;
const CLI_OPTION_KEYS = mergeOptionKeys(AUTOMIFY_OPTION_KEYS, [
  "command",
  "commands",
  "cwd",
  "env",
  "shell",
  "timeoutMs",
  "runner",
  "confirmCommand",
  "approval",
  "allowedCommands",
  "blockedCommands",
  "instructions",
  "logFile",
  "preset"
]);
const RUN_COMMAND_TOOL = {
  type: "function",
  name: "run_command",
  description:
    "Run a shell command in the configured working directory and return stdout, stderr, and the exit code. If the instructions include a command policy, the full command string must satisfy that policy before you call this tool.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: {
        type: "string",
        description:
          "The full shell command to run. If a command policy is present, this entire string is checked as one command."
      },
      cwd: {
        type: ["string", "null"],
        description: "Optional working directory. Use null to use the configured cwd."
      },
      timeoutMs: {
        type: ["number", "null"],
        description: "Optional command timeout in milliseconds. Use null to use the configured timeout."
      }
    },
    required: ["command", "cwd", "timeoutMs"]
  }
};

export function createCliAutomify(options = {}) {
  return new CliAutomify(options);
}

function normalizeCliOptions(options = {}) {
  assertKnownOptions("CLI adapter", options, CLI_OPTION_KEYS);
  assertKnownOptions("CLI command", options.command, COMMAND_OPTION_KEYS);
  assertKnownOptions("CLI command", options.commands, COMMAND_OPTION_KEYS);
  options = applyCliPreset(options);
  const command = options.commands ?? options.command ?? {};
  const confirmCommand = options.confirmCommand ?? command.confirm ?? command.confirmCommand;
  const limits = options.limits ?? {};
  const hooks = options.hooks ?? {};
  const safety = options.safety ?? {};
  const logFile = normalizeLogFile(options.logFile, "CLI logFile");

  return {
    ...options,
    debug: options.debug ?? false,
    logFile,
    maxSteps: options.maxSteps ?? limits.steps ?? limits.maxSteps,
    requestOptions: options.requestOptions ?? options.request,
    cwd: options.cwd ?? command.cwd,
    env: options.env ?? command.env,
    shell: options.shell ?? command.shell,
    timeoutMs: options.timeoutMs ?? command.timeoutMs ?? command.timeout,
    allowedCommands: options.allowedCommands ?? command.allow ?? command.allowed ?? command.allowedCommands,
    blockedCommands: options.blockedCommands ?? command.block ?? command.blocked ?? command.blockedCommands,
    confirmCommand,
    approval: options.approval ?? command.approval,
    onStep: options.onStep ?? hooks.step ?? hooks.onStep,
    onComplete: options.onComplete ?? hooks.complete ?? hooks.onComplete,
    safetyIdentifier: options.safetyIdentifier ?? safety.identifier ?? safety.safetyIdentifier
  };
}

export class CliAutomify {
  constructor(options = {}) {
    const {
      openaiApiKey,
      client,
      model,
      baseURL,
      fetchImpl,
      maxSteps = DEFAULT_MAX_STEPS,
      requestOptions,
      cwd = process.cwd(),
      env,
      shell = true,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      runner = runShellCommand,
      confirmCommand,
      approval = confirmCommand ? "always" : "never",
      allowedCommands,
      blockedCommands,
      onStep,
      onRequest,
      onResponse,
      onComplete,
      debug,
      logFile,
      silent,
      reasoning,
      safetyIdentifier
    } = normalizeCliOptions(options);

    this.client = client ?? new OpenAIResponsesClient({ openaiApiKey, baseURL, fetchImpl });
    this.model = model;
    this.maxSteps = maxSteps;
    this.requestOptions = requestOptions;
    this.cwd = cwd;
    this.env = env;
    this.shell = shell;
    this.timeoutMs = timeoutMs;
    this.runner = runner;
    this.confirmCommand = confirmCommand;
    this.approval = approval;
    this.allowedCommands = allowedCommands;
    this.blockedCommands = blockedCommands;
    this.onStep = onStep;
    this.onRequest = onRequest;
    this.onResponse = onResponse;
    this.onComplete = onComplete;
    this.debug = debug;
    this.logFile = logFile;
    this.silent = silent;
    this.reasoning = reasoning;
    this.safetyIdentifier = safetyIdentifier;
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
      const steps = [];
      const requestOptions = options.requestOptions ?? this.requestOptions;
      const model = assertModel(options.model ?? this.model);
      const allowedCommands = options.allowedCommands ?? this.allowedCommands;
      const blockedCommands = options.blockedCommands ?? this.blockedCommands;
      const approval = options.approval ?? this.approval;
      let response = await this.#createResponse(
        mergeRequestOptions(requestOptions, {
          model,
          instructions: cliInstructions({
            instructions: options.instructions,
            allowedCommands,
            blockedCommands,
            approval
          }),
          tools: [RUN_COMMAND_TOOL],
          tool_choice: "auto",
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: formatCliInstruction(instruction, data, options.cwd ?? this.cwd) },
                ...await evaluationContentFor(options.filesToEvaluate)
              ]
            }
          ],
          text: buildTextConfig(options.output),
          reasoning: options.reasoning ?? this.reasoning,
          safety_identifier: options.safetyIdentifier ?? this.safetyIdentifier,
          truncation: "auto"
        }),
        { phase: "initial", surface: "cli", requestOptions }
      );

      for (let step = 0; step < maxSteps; step += 1) {
        const calls = findRunCommandCalls(response);

        if (calls.length === 0) {
          const result = buildRunResult(response, steps, options.output);
          await this.#complete(result, { instruction, data }, options);
          return result;
        }

        const input = [];

        for (const call of calls) {
          const command = parseRunCommand(call);
          assertCommandPolicy(command.command, allowedCommands, blockedCommands);
          await this.#confirm(command, call, response, options);
          await this.#emitStep(
            {
              index: steps.length,
              phase: "before_command",
              command,
              call,
              response
            },
            options
          );

          this.#debug("command", {
            command,
            cwd: command.cwd ?? options.cwd ?? this.cwd,
            timeoutMs: command.timeoutMs ?? options.timeoutMs ?? this.timeoutMs
          });
          const output = await this.runner(command.command, {
            cwd: command.cwd ?? options.cwd ?? this.cwd,
            env: options.env ?? this.env,
            shell: options.shell ?? this.shell,
            timeoutMs: command.timeoutMs ?? options.timeoutMs ?? this.timeoutMs
          });
          this.#debug("command_result", {
            command,
            exitCode: output?.exitCode,
            signal: output?.signal,
            timedOut: output?.timedOut,
            stdout: output?.stdout,
            stderr: output?.stderr,
            stdoutLength: typeof output?.stdout === "string" ? output.stdout.length : undefined,
            stderrLength: typeof output?.stderr === "string" ? output.stderr.length : undefined
          });
          await this.#emitStep(
            {
              index: steps.length,
              phase: "after_command",
              command,
              call,
              response,
              output
            },
            options
          );

          steps.push({
            index: steps.length,
            callId: call.call_id,
            command,
            output
          });

          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(output)
          });
        }

        response = await this.#createResponse(
          mergeRequestOptions(requestOptions, {
            model,
            previous_response_id: response.id,
            tools: [RUN_COMMAND_TOOL],
            input,
            text: buildTextConfig(options.output),
            truncation: "auto"
          }),
          { phase: "continue", surface: "cli", step, requestOptions }
        );
      }

      throw new MaxStepsExceededError(maxSteps);
    } finally {
      this.silent = previousSilent;
    }
  }

  async #confirm(command, call, response, options) {
    const approval = options.approval ?? this.approval;
    if (approval === "never") return;

    if (typeof this.confirmCommand !== "function" && typeof options.confirmCommand !== "function") {
      throw new AutomifyError("CLI command approval is required. Pass confirmCommand or set approval: 'never'.");
    }

    const confirmCommand = options.confirmCommand ?? this.confirmCommand;
    const approved = await confirmCommand({ command, call, response });

    if (!approved) {
      throw new AutomifyError(`CLI command was not approved: ${command.command}`);
    }
  }

  async #createResponse(payload, meta) {
    await callHook(this.onRequest, payload, meta);
    this.#debug("request", { meta, payload: summarizePayload(payload) });
    const response = await this.client.createResponse(payload, meta);
    await callHook(this.onResponse, response, meta);
    this.#debug("response", { meta, response: summarizeResponse(response) });
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
      surface: "cli"
    };

    await callHook(this.onComplete, event);
    await callHook(options.onComplete, event);
    this.#debug("complete", event);
  }

  #debug(message, details) {
    writeDebugLogFile(this.logFile, "automify:cli", message, details, { silent: this.silent });
    debugLog(this.debug, "automify:cli", message, details, { silent: this.silent });
  }
}

function cliInstructions(options) {
  return [
    options.instructions ??
      [
        "You are controlling a shell through the run_command tool.",
        "Use deterministic, task-directed commands. Do not run exploratory commands as a probe when the next command is already clear. Prefer project-local tooling and explicit working directories.",
        "Inspect first only when the right command, file, or project layout is uncertain; make the inspection narrow and explainable by the task. Prefer fast, focused commands such as pwd, ls, find targets, or ripgrep over broad scans.",
        "Prefer focused, verifiable commands that produce bounded output. Avoid long-running, interactive, destructive, network, or environment-changing commands unless the task requires them and policy allows them.",
        "Do not repeat a command after no useful change unless you change the hypothesis, arguments, working directory, or diagnostic target.",
        "After a command changes files, runs tests, or produces the requested result, decide from its output whether another command is necessary. Stop when the task is complete and return a concise summary instead of calling more tools."
      ].join("\n"),
    commandPolicyGuidance(options)
  ].filter(Boolean).join("\n\n");
}

function assertModel(model) {
  if (typeof model !== "string" || model.trim() === "") {
    throw new AutomifyError("A model is required. Pass model to initAutomify(), cli(), or do().");
  }

  return model;
}

function formatCliInstruction(instruction, data, cwd) {
  const parts = [`Task:\n${instruction}`, `Working directory:\n${cwd}`];

  if (data != null && !(typeof data === "object" && Object.keys(data).length === 0)) {
    parts.push(`Data:\n${JSON.stringify(data, null, 2)}`);
  }

  return parts.join("\n\n");
}

async function evaluationContentFor(files) {
  if (files == null) return [];
  return filesToEvaluate(files);
}

function findRunCommandCalls(response) {
  return response?.output?.filter((item) => item.type === "function_call" && item.name === "run_command") ?? [];
}

function parseRunCommand(call) {
  try {
    const args = JSON.parse(call.arguments || "{}");
    if (typeof args.command !== "string" || args.command.trim() === "") {
      throw new AutomifyError("run_command requires a non-empty command argument.");
    }

    return {
      command: args.command,
      cwd: args.cwd ?? undefined,
      timeoutMs: args.timeoutMs ?? undefined
    };
  } catch (error) {
    if (error instanceof AutomifyError) throw error;
    throw new AutomifyError("run_command arguments must be valid JSON.", { cause: error });
  }
}

function assertCommandPolicy(command, allowedCommands, blockedCommands) {
  if (blockedCommands?.some((rule) => matchesCommandRule(command, rule))) {
    throw new AutomifyError(`CLI command is blocked by policy: ${command}`);
  }

  if (allowedCommands?.length && !allowedCommands.some((rule) => matchesCommandRule(command, rule))) {
    throw new AutomifyError(`CLI command is not allowed by policy: ${command}`);
  }
}

function commandPolicyGuidance(options) {
  const lines = [];
  const allowed = commandRulesGuidance(options.allowedCommands);
  const blocked = commandRulesGuidance(options.blockedCommands);

  if (allowed) {
    lines.push(`Only call run_command with commands matching one of these allowed command rules: ${allowed}.`);
    lines.push(
      "This allowlist is mandatory. Before every run_command call, compare the exact full command string you are about to send against the allowed rules."
    );
    lines.push(
      "The policy is checked against the full shell command string, not individual words inside it. Shell operators and conditionals such as &&, ||, ;, pipes, if, test, and [ ] do not make an unlisted command valid."
    );
    lines.push(
      'For example, if only "cat" is allowed, do not call commands like "ls data && cat data/file", "if [ -f data/file ]; then cat data/file; fi", "sh -lc ...", or any other wrapper/listing/test command unless the entire string matches an allowed rule.'
    );
    lines.push(
      "If the task cannot be completed with commands that match the allowlist, stop and explain which command rule is missing instead of trying a near match."
    );
  }
  if (blocked) {
    lines.push(`Do not call run_command with commands matching any of these blocked command rules: ${blocked}.`);
  }
  if (options.approval === "always") {
    lines.push("Commands require approval before execution; request only commands that are necessary for the task.");
  }

  return lines.length ? `Command policy:\n${lines.join("\n")}` : "";
}

function commandRulesGuidance(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return "";
  return rules.map(commandRuleGuidance).join(", ");
}

function commandRuleGuidance(rule) {
  if (rule instanceof RegExp) return rule.toString();
  if (typeof rule === "function") return "[custom command rule]";
  const value = String(rule);
  return `${JSON.stringify(value)} (exact command or command prefix with arguments)`;
}

function matchesCommandRule(command, rule) {
  if (rule instanceof RegExp) return rule.test(command);
  if (typeof rule === "function") return rule(command);
  return command === String(rule) || command.startsWith(`${String(rule)} `);
}

export function runShellCommand(command, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: options.shell ?? true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      settle({
        command,
        cwd: options.cwd,
        exitCode: null,
        stdout,
        stderr: stderr || error.message,
        timedOut
      });
    });
    child.on("close", (exitCode, signal) => {
      settle({
        command,
        cwd: options.cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut
      });
    });
  });
}
