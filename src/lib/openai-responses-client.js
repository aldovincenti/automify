import { AutomifyError } from "./errors.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;

export class OpenAIResponsesClient {
  constructor({
    openaiApiKey,
    baseURL = DEFAULT_BASE_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = 500
  } = {}) {
    this.openaiApiKey = openaiApiKey;
    this.baseURL = baseURL.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;

    if (!this.openaiApiKey) {
      throw new AutomifyError("An openaiApiKey is required.");
    }

    if (typeof this.fetch !== "function") {
      throw new AutomifyError("A fetch implementation is required. Use Node 18+ or pass fetchImpl.");
    }
  }

  async createResponse(payload) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.#fetchResponse(payload);
        const text = await response.text();
        const data = parseJson(text);

        if (!response.ok) {
          const message = data?.error?.message ?? data?.message ?? response.statusText;
          const requestId = response.headers?.get?.("x-request-id") ?? response.headers?.get?.("openai-request-id");
          const error = new AutomifyError(`OpenAI Responses request failed${requestId ? ` (${requestId})` : ""}: ${message}`);
          error.status = response.status;
          error.requestId = requestId;
          if (attempt < this.maxRetries && isRetryableStatus(response.status)) {
            lastError = error;
            await wait(retryDelay(attempt, this.retryDelayMs, response.headers?.get?.("retry-after")));
            continue;
          }
          throw error;
        }

        return data;
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxRetries || !isRetryableError(error)) {
          throw error;
        }
        await wait(retryDelay(attempt, this.retryDelayMs));
      }
    }

    throw lastError;
  }

  async #fetchResponse(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestPayload = toOpenAIResponsesPayload(payload);

    try {
      return await this.fetch(`${this.baseURL}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.openaiApiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toOpenAIResponsesPayload(payload) {
  if (!Array.isArray(payload?.tools)) return payload;

  let changed = false;
  const tools = payload.tools.map((tool) => {
    const next = toOpenAIResponsesTool(tool, payload);
    if (next !== tool) changed = true;
    return next;
  });

  return changed ? { ...payload, tools } : payload;
}

function toOpenAIResponsesTool(tool, payload) {
  if (!tool || (tool.type !== "computer" && tool.type !== "computer_use_preview")) {
    return tool;
  }

  if (payload?.model === "computer-use-preview") {
    return toOpenAIPreviewComputerTool(tool);
  }

  return toOpenAIGaComputerTool(tool);
}

function toOpenAIGaComputerTool(tool) {
  const { displayWidth, displayHeight, display_width, display_height, environment, ...rest } = tool;
  return {
    ...rest,
    type: "computer"
  };
}

function toOpenAIPreviewComputerTool(tool) {
  const { displayWidth, displayHeight, display_width, display_height, ...rest } = tool;
  return cleanUndefined({
    ...rest,
    type: "computer_use_preview",
    display_width: display_width ?? displayWidth,
    display_height: display_height ?? displayHeight
  });
}

function parseJson(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AutomifyError("OpenAI Responses request returned invalid JSON.", { cause: error });
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(error) {
  return error?.name === "AbortError" || error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT" || /fetch failed/i.test(error?.message ?? "");
}

function retryDelay(attempt, baseDelayMs, retryAfter) {
  const retryAfterMs = Number(retryAfter) * 1000;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
  return Math.max(0, Number(baseDelayMs) || 0) * (2 ** attempt);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}
