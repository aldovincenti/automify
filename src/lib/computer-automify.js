import { Automify, createAutomify } from "./automify.js";
import {
  createDockerDesktopComputer,
  DOCKER_DESKTOP_COMPUTER_OPTION_KEYS
} from "./docker-desktop-computer.js";
import {
  createLocalDesktopComputer,
  LOCAL_DESKTOP_COMPUTER_OPTION_KEYS
} from "./local-desktop-computer.js";
import {
  AUTOMIFY_OPTION_KEYS,
  assertKnownOptions,
  mergeOptionKeys,
  pickKnownOptions
} from "./runtime.js";

const DOCKER_COMPUTER_AUTOMIFY_OPTION_KEYS = mergeOptionKeys(
  AUTOMIFY_OPTION_KEYS,
  DOCKER_DESKTOP_COMPUTER_OPTION_KEYS
);
const LOCAL_COMPUTER_AUTOMIFY_OPTION_KEYS = mergeOptionKeys(
  AUTOMIFY_OPTION_KEYS,
  LOCAL_DESKTOP_COMPUTER_OPTION_KEYS
);

export function createComputerAutomify(options = {}) {
  return createAutomify({
    environment: defaultComputerEnvironment(),
    ...options
  });
}

export async function createDockerComputerAutomify(options = {}) {
  assertKnownOptions("Docker computer adapter", options, DOCKER_COMPUTER_AUTOMIFY_OPTION_KEYS);
  const usesProvidedComputer = Boolean(options.computer);
  const computer = options.computer ?? (await createDockerDesktopComputer(
    pickKnownOptions(options, DOCKER_DESKTOP_COMPUTER_OPTION_KEYS)
  ));
  const automifyOptions = pickKnownOptions(options, AUTOMIFY_OPTION_KEYS);
  if (!usesProvidedComputer) {
    delete automifyOptions.instructions;
  }

  return new DockerComputerAutomify({
    ...automifyOptions,
    computer
  });
}

export async function createLocalComputerAutomify(options = {}) {
  assertKnownOptions("local computer adapter", options, LOCAL_COMPUTER_AUTOMIFY_OPTION_KEYS);
  const usesProvidedComputer = Boolean(options.computer);
  const computer = options.computer ?? (await createLocalDesktopComputer(
    pickKnownOptions(options, LOCAL_DESKTOP_COMPUTER_OPTION_KEYS)
  ));
  const automifyOptions = pickKnownOptions(options, AUTOMIFY_OPTION_KEYS);
  if (!usesProvidedComputer) {
    delete automifyOptions.instructions;
  }

  return new LocalComputerAutomify({
    sendInitialScreenshot: true,
    ...automifyOptions,
    computer
  });
}

export class LocalComputerAutomify extends Automify {
  constructor(options) {
    super(pickKnownOptions(options, AUTOMIFY_OPTION_KEYS));
  }

  async close() {
    if (typeof this.computer.close === "function") {
      await this.computer.close();
    }
  }
}

export class DockerComputerAutomify extends Automify {
  constructor(options) {
    super(pickKnownOptions(options, AUTOMIFY_OPTION_KEYS));
    this.session = this.computer.session;
    this.sharedFolder = this.computer.sharedFolder;
  }

  async close() {
    if (typeof this.computer.close === "function") {
      await this.computer.close();
    }
  }
}

function defaultComputerEnvironment() {
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    default:
      return "ubuntu";
  }
}
