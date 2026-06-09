import { createAutomify } from "./automify.js";
import { createBrowserAutomify, withBrowserAutomify } from "./browser-automify.js";
import { createCliAutomify } from "./cli-automify.js";
import { createDockerCliAutomify } from "./docker-cli-automify.js";
import { createVirtualCliAutomify } from "./qemu-cli-automify.js";
import {
  createComputerAutomify,
  createDockerComputerAutomify,
  createLocalComputerAutomify,
  createVirtualComputerAutomify
} from "./computer-automify.js";
import { createAnthropicModelAdapter } from "./anthropic-model-adapter.js";
import { AutomifyError } from "./errors.js";
import { createModelAdapter } from "./model-adapter.js";
import { OpenAIResponsesClient } from "./openai-responses-client.js";

const ANTHROPIC_COMPUTER_SCREENSHOT_MAX_WIDTH = 1280;
const ANTHROPIC_COMPUTER_SCREENSHOT_MAX_HEIGHT = 800;

export function initAutomify(options = {}) {
  const provider = normalizeProvider(options);
  const client = createClient(provider);
  const limits = options.limits ?? {};
  const safety = options.safety ?? {};
  const hooks = options.hooks ?? {};
  const screenshots = options.screenshots ?? {};
  const screenshot = options.screenshot ?? {};
  const providerScreenshotDefaults = screenshotDefaultsForProvider(provider);
  const defaults = {
    model: provider.model,
    maxSteps: options.maxSteps ?? limits.steps ?? limits.maxSteps,
    requestOptions: options.requestOptions,
    reasoning: options.reasoning,
    safetyIdentifier: options.safetyIdentifier ?? safety.identifier ?? safety.safetyIdentifier,
    allowedDomains: options.allowedDomains ?? safety.domains ?? safety.allowedDomains,
    onStep: options.onStep ?? hooks.step ?? hooks.onStep,
    onRequest: options.onRequest,
    onResponse: options.onResponse,
    onComplete: options.onComplete ?? hooks.complete ?? hooks.onComplete,
    redactScreenshot: options.redactScreenshot ?? screenshot.redact ?? screenshot.redactScreenshot,
    screenshotDetail: options.screenshotDetail ?? screenshot.detail,
    screenshotMaxWidth:
      options.screenshotMaxWidth ??
      screenshot.maxWidth ??
      screenshot.screenshotMaxWidth ??
      providerScreenshotDefaults.maxWidth,
    screenshotMaxHeight:
      options.screenshotMaxHeight ??
      screenshot.maxHeight ??
      screenshot.screenshotMaxHeight ??
      providerScreenshotDefaults.maxHeight,
    screenshotResize: options.screenshotResize ?? screenshot.resize ?? screenshot.screenshotResize,
    initialScreenshot: options.initialScreenshot ?? screenshots.initial,
    finalScreenshot: options.finalScreenshot ?? screenshots.final,
    actionScreenshots: options.actionScreenshots ?? screenshots.actions ?? screenshots.actionScreenshots,
    trace: options.trace,
    silent: options.silent,
    debug: options.debug ?? false
  };
  const computerDefaults = {
    ...defaults,
    model: options.computerModel ?? provider.computerModel ?? provider.model
  };

  return {
    client,

    browser(browserOptions = {}) {
      return createBrowserAutomify({
        ...computerDefaults,
        ...browserOptions,
        client
      });
    },

    withBrowser(browserOptions = {}, run) {
      return withBrowserAutomify(
        {
          ...computerDefaults,
          ...browserOptions,
          client
        },
        run
      );
    },

    cli(cliOptions = {}) {
      return createCliAutomify({
        ...defaults,
        ...cliOptions,
        client
      });
    },

    dockerCli(cliOptions = {}) {
      return createDockerCliAutomify({
        ...defaults,
        ...cliOptions,
        client
      });
    },

    dockerComputer(computerOptions = {}) {
      return createDockerComputerAutomify({
        ...computerDefaults,
        ...computerOptions,
        client
      });
    },

    localComputer(computerOptions = {}) {
      return createLocalComputerAutomify({
        ...computerDefaults,
        ...computerOptions,
        client
      });
    },

    virtualComputer(computerOptions = {}) {
      return createVirtualComputerAutomify({
        ...computerDefaults,
        ...computerOptions,
        client
      });
    },

    virtualCli(cliOptions = {}) {
      return createVirtualCliAutomify({
        ...defaults,
        ...cliOptions,
        client
      });
    },

    computer(computerOptions = {}) {
      return createComputerAutomify({
        ...computerDefaults,
        ...computerOptions,
        client
      });
    },

    custom(automifyOptions = {}) {
      return createAutomify({
        ...defaults,
        ...automifyOptions,
        client
      });
    }
  };
}

function screenshotDefaultsForProvider(provider) {
  if (provider.type !== "anthropic") return {};
  return {
    maxWidth: ANTHROPIC_COMPUTER_SCREENSHOT_MAX_WIDTH,
    maxHeight: ANTHROPIC_COMPUTER_SCREENSHOT_MAX_HEIGHT
  };
}

function createClient(provider) {
  if (provider.type === "custom") {
    if (provider.client) return provider.client;
    return createModelAdapter(provider.adapter, provider.options ?? {});
  }

  if (provider.type === "anthropic") {
    return createAnthropicModelAdapter({
      ...withoutProviderKeys(provider),
      anthropicApiKey: provider.apiKey
    });
  }

  if (provider.type !== "openai") {
    throw new AutomifyError(`Unsupported provider.type: ${provider.type}`);
  }

  return new OpenAIResponsesClient({
    ...withoutProviderKeys(provider),
    openaiApiKey: provider.apiKey
  });
}

function normalizeProvider(options) {
  if (options.provider && typeof options.provider === "object") {
    const provider = {
      ...options.provider,
      type: options.provider.type ?? options.provider.name
    };
    validateProvider(provider);
    return provider;
  }

  if (typeof options.provider === "string") {
    throw new AutomifyError("initAutomify provider must be an object, for example { type: 'openai', apiKey, model }.");
  }

  throw new AutomifyError(
    "initAutomify requires provider: { type, apiKey, model } or provider: { type: 'custom', adapter, model }."
  );
}

function withoutProviderKeys(provider) {
  const { type, name, apiKey, model, adapter, client, options, ...rest } = provider;
  return rest;
}

function validateProvider(provider) {
  if (!provider.type || typeof provider.type !== "string") {
    throw new AutomifyError("provider.type is required.");
  }

  if (!provider.model || typeof provider.model !== "string") {
    throw new AutomifyError("provider.model is required.");
  }

  if (provider.type === "custom") {
    if (!provider.adapter && !provider.client) {
      throw new AutomifyError("provider.adapter or provider.client is required when provider.type is 'custom'.");
    }
    return;
  }

  if (!provider.apiKey || typeof provider.apiKey !== "string") {
    throw new AutomifyError("provider.apiKey is required.");
  }
}
