import { AutomifyError } from "./errors.js";

const REPO_COMMAND = {
  cwd: process.cwd(),
  allow: ["git", "node", "npm", "pnpm", "yarn", "bun"],
  block: [/^rm\s+-rf\b/]
};

export function applyBrowserPreset(options = {}) {
  switch (options.preset) {
    case undefined:
    case null:
      return options;
    case "browser-review":
      return mergePreset(
        {
          limits: { steps: 50 },
          screenshot: { detail: "high" }
        },
        options
      );
    default:
      throw unknownPreset("browser", options.preset, ["browser-review"]);
  }
}

export function applyCliPreset(options = {}) {
  switch (options.preset) {
    case undefined:
    case null:
      return options;
    case "repo":
      return mergePreset({ command: REPO_COMMAND }, options);
    case "locked-down-cli":
      return mergePreset(
        {
          command: {
            approval: "always",
            allow: [],
            block: [/^rm\b/, /^sudo\b/, /^curl\b/, /^wget\b/]
          },
          limits: { steps: 20 }
        },
        options
      );
    default:
      throw unknownPreset("cli", options.preset, ["repo", "locked-down-cli"]);
  }
}

export function applyDockerCliPreset(options = {}) {
  switch (options.preset) {
    case undefined:
    case null:
      return options;
    case "repo":
      return mergePreset(
        {
          command: REPO_COMMAND,
          shared: {
            hostPath: process.cwd(),
            containerPath: "/workspace"
          }
        },
        options
      );
    case "locked-down-cli":
      return mergePreset(
        {
          command: {
            approval: "always",
            allow: [],
            block: [/^rm\b/, /^sudo\b/, /^curl\b/, /^wget\b/]
          },
          container: {
            network: "none",
            sandbox: true,
            readOnly: true
          },
          limits: { steps: 20 }
        },
        options
      );
    default:
      throw unknownPreset("Docker CLI", options.preset, ["repo", "locked-down-cli"]);
  }
}

export const applyVirtualCliPreset = applyDockerCliPreset;

export function applyDockerDesktopPreset(options = {}) {
  switch (options.preset) {
    case undefined:
    case null:
      return options;
    case "desktop-review":
      return mergePreset(
        {
          viewport: { width: 1440, height: 900 },
          waitMs: 750,
          screenshotSettleMs: 500
        },
        options
      );
    default:
      throw unknownPreset("Docker desktop", options.preset, ["desktop-review"]);
  }
}

export const applyVirtualDesktopPreset = applyDockerDesktopPreset;

function mergePreset(defaults, options) {
  return {
    ...defaults,
    ...options,
    command: mergeObject(defaults.command, options.command ?? options.commands),
    commands: options.commands,
    container: mergeObject(defaults.container, options.container),
    desktop: mergeObject(defaults.desktop, options.desktop),
    limits: mergeObject(defaults.limits, options.limits),
    safety: mergeObject(defaults.safety, options.safety),
    screenshot: mergeObject(defaults.screenshot, options.screenshot),
    screenshots: mergeObject(defaults.screenshots, options.screenshots),
    viewport: mergeObject(defaults.viewport, options.viewport),
    shared: options.shared ?? options.sharedFolder ?? defaults.shared
  };
}

function mergeObject(defaults, overrides) {
  if (defaults == null && overrides == null) return undefined;
  return {
    ...(defaults ?? {}),
    ...(overrides ?? {})
  };
}

function unknownPreset(surface, preset, allowed) {
  return new AutomifyError(
    `Unknown ${surface} preset ${JSON.stringify(preset)}. Available presets: ${allowed.map((name) => JSON.stringify(name)).join(", ")}.`
  );
}
