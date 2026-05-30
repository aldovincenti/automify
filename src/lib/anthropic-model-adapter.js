import {
  computerCall,
  getFunctionOutputs,
  getLastComputerScreenshot,
  getInputText,
  message,
  parseDataUrl,
  response,
  runCommandCall
} from "./adapter-toolkit.js";
import { AutomifyError } from "./errors.js";
import { buildOutputInstruction } from "./result.js";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

export function createAnthropicModelAdapter(options = {}) {
  return new AnthropicModelAdapter(options);
}

export class AnthropicModelAdapter {
  constructor({
    anthropicApiKey,
    baseURL = DEFAULT_ANTHROPIC_BASE_URL,
    version = DEFAULT_ANTHROPIC_VERSION,
    betas = ["computer-use-2025-01-24"],
    fetchImpl = globalThis.fetch,
    maxTokens = DEFAULT_MAX_TOKENS,
    computerToolType = "computer_20250124",
    requestTransform,
    responseTransform
  } = {}) {
    this.anthropicApiKey = anthropicApiKey;
    this.baseURL = baseURL.replace(/\/$/, "");
    this.version = version;
    this.betas = betas;
    this.fetch = fetchImpl;
    this.maxTokens = maxTokens;
    this.computerToolType = computerToolType;
    this.requestTransform = requestTransform;
    this.responseTransform = responseTransform;
    this.transcripts = new Map();

    if (!this.anthropicApiKey) {
      throw new AutomifyError("An anthropicApiKey is required.");
    }

    if (typeof this.fetch !== "function") {
      throw new AutomifyError("A fetch implementation is required. Use Node 18+ or pass fetchImpl.");
    }
  }

  async createResponse(payload, context = {}) {
    const request = await this.#toAnthropicRequest(payload, context);
    const finalRequest =
      typeof this.requestTransform === "function"
        ? await this.requestTransform(request, { payload, context })
        : request;

    const res = await this.fetch(`${this.baseURL}/messages`, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify(finalRequest)
    });
    const text = await res.text();
    const data = parseJson(text);

    if (!res.ok) {
      throw new AutomifyError(`Anthropic request failed: ${data?.error?.message ?? data?.message ?? res.statusText}`);
    }

    const finalData =
      typeof this.responseTransform === "function"
        ? await this.responseTransform(data, { payload, context, request: finalRequest })
        : data;
    const automifyResponse = this.#fromAnthropicResponse(finalData, context, payload);
    const previous = payload.previous_response_id ? this.transcripts.get(payload.previous_response_id) ?? [] : [];
    this.transcripts.set(automifyResponse.id, compactMessagesForStorage([
      ...previous,
      ...this.#userMessagesFromPayload(payload, context),
      { role: "assistant", content: finalData.content ?? [] }
    ], context));

    return automifyResponse;
  }

  #headers() {
    const headers = {
      "x-api-key": this.anthropicApiKey,
      "anthropic-version": this.version,
      "content-type": "application/json"
    };

    if (this.betas?.length) {
      headers["anthropic-beta"] = Array.isArray(this.betas) ? this.betas.join(",") : this.betas;
    }

    return headers;
  }

  async #toAnthropicRequest(payload, context) {
    const previous = payload.previous_response_id ? this.transcripts.get(payload.previous_response_id) ?? [] : [];
    const messages = compactMessagesForRequest([...previous, ...this.#userMessagesFromPayload(payload, context)], context);
    const tools = this.#toolsFromPayload(payload);

    return removeUndefined({
      model: assertModel(payload.model),
      max_tokens: payload.max_tokens ?? payload.maxTokens ?? this.maxTokens,
      temperature: payload.temperature,
      top_p: payload.top_p,
      top_k: payload.top_k,
      stop_sequences: payload.stop_sequences,
      system: payload.system ?? payload.instructions,
      metadata: payload.metadata,
      thinking: payload.thinking,
      messages,
      tools: tools.length ? tools : undefined
    });
  }

  #userMessagesFromPayload(payload, context) {
    const outputInstruction = buildOutputInstruction(payload.text);

    if (context.phase === "continue") {
      const content = [];

      for (const item of payload.input ?? []) {
        if (item.type === "computer_call_output") {
          content.push({
            type: "tool_result",
            tool_use_id: item.call_id,
            content: computerResultContent(item)
          });
        }

        if (item.type === "function_call_output") {
          content.push({
            type: "tool_result",
            tool_use_id: item.call_id,
            content: typeof item.output === "string" ? item.output : JSON.stringify(item.output)
          });
        }
      }

      if (outputInstruction) {
        content.push({ type: "text", text: outputInstruction });
      }

      if (content.length) return [{ role: "user", content }];
    }

    const content = [];
    const text = getInputText(payload);
    const finalText = [text, outputInstruction].filter(Boolean).join("\n\n");
    if (finalText) content.push({ type: "text", text: finalText });

    for (const item of payload.input ?? []) {
      for (const block of item.content ?? []) {
        if ((block.type === "input_image" || block.type === "computer_screenshot") && block.image_url) {
          content.push(imageBlock(block.image_url));
        }
      }
    }

    if (content.length === 0) {
      content.push({ type: "text", text: "Continue." });
    }

    return [{ role: "user", content }];
  }

  #toolsFromPayload(payload) {
    const tools = [];
    const screenshotDimensions = imageDimensions(getLastComputerScreenshot(payload)?.buffer);

    for (const tool of payload.tools ?? []) {
      if (tool.type === "computer") {
        tools.push({
          type: this.computerToolType,
          name: "computer",
          display_width_px: screenshotDimensions?.width ?? tool.display_width ?? tool.displayWidth ?? 1024,
          display_height_px: screenshotDimensions?.height ?? tool.display_height ?? tool.displayHeight ?? 768
        });
      } else if (tool.type === "function") {
        tools.push({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters
        });
      }
    }

    return tools;
  }

  #fromAnthropicResponse(data, context, payload = {}) {
    const output = [];

    for (const item of data.content ?? []) {
      if (item.type === "text" && item.text) {
        output.push(message(normalizeStructuredText(item.text, payload.text)));
      }

      if (item.type === "tool_use") {
        if (item.name === "run_command") {
          output.push(runCommandCall(item.input?.command ?? "", {
            callId: item.id,
            cwd: item.input?.cwd,
            timeoutMs: item.input?.timeoutMs
          }));
        } else if (item.name === "computer") {
          output.push(computerCall(mapAnthropicComputerAction(item.input), { callId: item.id }));
        } else {
          output.push({
            type: "function_call",
            name: item.name,
            call_id: item.id,
            arguments: JSON.stringify(item.input ?? {})
          });
        }
      }
    }

    return response({
      id: data.id ?? `anthropic_${Date.now()}`,
      output
    });
  }
}

function compactMessagesForRequest(messages, context) {
  if (context.surface !== "computer" || context.phase !== "continue") return messages;

  const currentUser = messages.at(-1);
  const latestAssistant = [...messages].reverse().find((item) => item?.role === "assistant");
  const initialUser = messages.find((item) => item?.role === "user");
  if (!currentUser || currentUser.role !== "user" || !latestAssistant || !initialUser) return messages;

  return [textOnlyUserMessage(initialUser), latestAssistant, currentUser].filter(Boolean);
}

function compactMessagesForStorage(messages, context) {
  if (context.surface !== "computer") return messages;

  const latestAssistant = [...messages].reverse().find((item) => item?.role === "assistant");
  const initialUser = messages.find((item) => item?.role === "user");
  if (!latestAssistant || !initialUser) return messages;

  return [textOnlyUserMessage(initialUser), latestAssistant].filter(Boolean);
}

function textOnlyUserMessage(message) {
  const content = Array.isArray(message?.content)
    ? message.content.filter((block) => block?.type === "text" && typeof block.text === "string")
    : [];
  if (content.length === 0) return null;
  return { role: "user", content };
}

function imageDimensions(value) {
  if (!value) return null;
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

function computerResultContent(item) {
  const content = [];

  if (item.current_url) {
    content.push({ type: "text", text: `Current URL: ${item.current_url}` });
  }

  if (item.output?.image_url) {
    content.push(imageBlock(item.output.image_url));
  }

  return content.length ? content : "Done.";
}

function imageBlock(imageUrl) {
  const image = parseDataUrl(imageUrl);
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.mediaType,
      data: image.base64
    }
  };
}

function mapAnthropicComputerAction(input = {}) {
  const action = input.action ?? input.type;
  const coordinate = input.coordinate ?? input.coordinates;
  const x = input.x ?? coordinate?.[0] ?? 0;
  const y = input.y ?? coordinate?.[1] ?? 0;

  switch (action) {
    case "left_click":
    case "click":
      return { type: "click", x, y, button: "left" };
    case "right_click":
      return { type: "click", x, y, button: "right" };
    case "middle_click":
      return { type: "click", x, y, button: "middle" };
    case "double_click":
      return { type: "double_click", x, y, button: "left" };
    case "mouse_move":
      return { type: "move", x, y };
    case "type":
      return { type: "type", text: input.text ?? "" };
    case "key":
      return { type: "keypress", keys: [input.text ?? input.key].filter(Boolean) };
    case "scroll": {
      const amount = input.scroll_amount ?? input.amount ?? 0;
      const direction = input.scroll_direction ?? input.direction;
      return {
        type: "scroll",
        x,
        y,
        scroll_x: direction === "left" ? -amount : direction === "right" ? amount : 0,
        scroll_y: direction === "up" ? -amount : amount
      };
    }
    case "screenshot":
      return { type: "screenshot" };
    case "wait":
      return { type: "wait" };
    default:
      return input.type ? input : { ...input, type: action ?? "unknown" };
  }
}

function removeUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function normalizeStructuredText(text, textConfig) {
  const format = textConfig?.format;
  if (!format || format.type === "text") return text;

  return extractJsonText(text) ?? text;
}

function extractJsonText(text) {
  if (typeof text !== "string") return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  if (isJson(trimmed)) return trimmed;

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const candidate = match[1].trim();
    if (isJson(candidate)) return candidate;
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char !== "{" && char !== "[") continue;

    const candidate = balancedJsonCandidate(trimmed, index);
    if (candidate && isJson(candidate)) return candidate;
  }

  return null;
}

function balancedJsonCandidate(text, start) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const open = stack.pop();
      if ((char === "}" && open !== "{") || (char === "]" && open !== "[")) return null;
      if (stack.length === 0) return text.slice(start, index + 1).trim();
    }
  }

  return null;
}

function isJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function parseJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AutomifyError("Anthropic request returned invalid JSON.", { cause: error });
  }
}

function assertModel(model) {
  if (typeof model !== "string" || model.trim() === "") {
    throw new AutomifyError("A model is required for Anthropic requests.");
  }

  return model;
}
