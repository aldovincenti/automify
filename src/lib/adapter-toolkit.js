import { AutomifyError } from "./errors.js";
import { createModelAdapter } from "./model-adapter.js";

export function response({ id = `resp_${Date.now()}`, output = [], ...rest } = {}) {
  return { id, output, ...rest };
}

export function message(text, options = {}) {
  return {
    type: "message",
    content: [
      {
        type: "output_text",
        text
      }
    ],
    ...options
  };
}

export function computerCall(action, options = {}) {
  const callId = options.callId ?? options.call_id ?? `call_${Date.now()}`;

  return {
    type: "computer_call",
    call_id: callId,
    action,
    pending_safety_checks: options.pendingSafetyChecks ?? options.pending_safety_checks ?? [],
    status: options.status ?? "completed",
    ...withoutKeys(options, ["callId", "call_id", "pendingSafetyChecks", "pending_safety_checks", "status"])
  };
}

export function runCommandCall(command, options = {}) {
  const callId = options.callId ?? options.call_id ?? `call_${Date.now()}`;

  return functionCall(
    "run_command",
    { command, cwd: options.cwd, timeoutMs: options.timeoutMs },
    {
      ...withoutKeys(options, ["callId", "call_id", "cwd", "timeoutMs"]),
      callId
    }
  );
}

export function functionCall(name, args = {}, options = {}) {
  return {
    type: "function_call",
    name,
    call_id: options.callId ?? options.call_id ?? `call_${Date.now()}`,
    arguments: typeof args === "string" ? args : JSON.stringify(removeUndefined(args)),
    ...withoutKeys(options, ["callId", "call_id"])
  };
}

export function getInputText(payload) {
  const chunks = [];

  for (const item of payload.input ?? []) {
    for (const content of item.content ?? []) {
      if (content?.type === "input_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n\n");
}

export function getTool(payload, typeOrName) {
  return payload.tools?.find((tool) => tool.type === typeOrName || tool.name === typeOrName) ?? null;
}

export function getComputerTool(payload) {
  return getTool(payload, "computer");
}

export function getLastComputerScreenshot(payload) {
  for (const item of [...(payload.input ?? [])].reverse()) {
    if (item?.type === "computer_call_output" && item.output?.image_url) {
      return parseDataUrl(item.output.image_url);
    }

    for (const content of [...(item.content ?? [])].reverse()) {
      if ((content?.type === "input_image" || content?.type === "computer_screenshot") && content.image_url) {
        return parseDataUrl(content.image_url);
      }
    }
  }

  return null;
}

export function getFunctionOutputs(payload) {
  return (payload.input ?? [])
    .filter((item) => item?.type === "function_call_output")
    .map((item) => ({
      callId: item.call_id,
      output: parseMaybeJson(item.output)
    }));
}

export function getOutputText(response) {
  const chunks = [];

  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;

    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n\n");
}

export function parseOutputJson(response) {
  const text = getOutputText(response);
  if (!text) {
    throw new AutomifyError("Expected the model response to contain output text.");
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AutomifyError("Expected the model response text to be valid JSON.", { cause: error });
  }
}

export function parseDataUrl(value) {
  if (typeof value !== "string") {
    throw new AutomifyError("Expected a data URL or base64 string.");
  }

  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) {
    return {
      mediaType: "image/png",
      base64: value,
      buffer: Buffer.from(value, "base64")
    };
  }

  const mediaType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const data = match[3] ?? "";
  const buffer = isBase64 ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data));

  return {
    mediaType,
    base64: isBase64 ? data : buffer.toString("base64"),
    buffer
  };
}

export function toDataUrl(input, mediaType = "image/png") {
  if (typeof input === "string" && input.startsWith("data:")) return input;
  if (typeof input === "string") return `data:${mediaType};base64,${input}`;
  if (input instanceof ArrayBuffer) return `data:${mediaType};base64,${Buffer.from(input).toString("base64")}`;
  if (ArrayBuffer.isView(input)) {
    return `data:${mediaType};base64,${Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString("base64")}`;
  }

  throw new AutomifyError("toDataUrl input must be a data URL, base64 string, Buffer, Uint8Array, or ArrayBuffer.");
}

export async function testModelAdapter(adapter, scenarios = defaultAdapterScenarios()) {
  const modelAdapter = createModelAdapter(adapter);

  for (const scenario of scenarios) {
    const result = await modelAdapter.createResponse(scenario.payload, scenario.context);
    scenario.assert?.(result);
    assertResponseShape(result, scenario.name);
  }
}

export function defaultAdapterScenarios() {
  return [
    {
      name: "text",
      context: { surface: "cli", phase: "initial" },
      payload: {
        model: "adapter-test",
        input: [{ role: "user", content: [{ type: "input_text", text: "Say hello" }] }],
        tools: []
      }
    },
    {
      name: "computer",
      context: { surface: "computer", phase: "initial" },
      payload: {
        model: "adapter-test",
        input: [{ role: "user", content: [{ type: "input_text", text: "Click the button" }] }],
        tools: [{ type: "computer" }]
      }
    },
    {
      name: "cli",
      context: { surface: "cli", phase: "initial" },
      payload: {
        model: "adapter-test",
        input: [{ role: "user", content: [{ type: "input_text", text: "Run tests" }] }],
        tools: [{ type: "function", name: "run_command" }]
      }
    }
  ];
}

function assertResponseShape(result, scenarioName) {
  if (!result || typeof result !== "object") {
    throw new AutomifyError(`Adapter scenario '${scenarioName}' did not return an object.`);
  }

  if (typeof result.id !== "string" || result.id.length === 0) {
    throw new AutomifyError(`Adapter scenario '${scenarioName}' must return a string id.`);
  }

  if (!Array.isArray(result.output)) {
    throw new AutomifyError(`Adapter scenario '${scenarioName}' must return an output array.`);
  }
}

function withoutKeys(object, keys) {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(object).filter(([key]) => !blocked.has(key)));
}

function removeUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
