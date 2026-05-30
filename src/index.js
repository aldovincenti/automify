export {
  Automify,
  createAutomify,
  AutomifyError,
  SafetyCheckError,
  MaxStepsExceededError
} from "./lib/automify.js";

export { OpenAIResponsesClient } from "./lib/openai-responses-client.js";
export { AnthropicModelAdapter, createAnthropicModelAdapter } from "./lib/anthropic-model-adapter.js";
export {
  createBrowserComputer,
  createPlaywrightComputer,
  executePlaywrightAction
} from "./lib/playwright-computer.js";
export {
  captureLocalDesktopScreenshot,
  createLocalDesktopComputer,
  executeLocalDesktopAction
} from "./lib/local-desktop-computer.js";
export {
  DockerDesktopSession,
  DockerVirtualDesktopSession,
  createDockerDesktopComputer,
  createVirtualDesktopComputer,
  defaultDockerDesktopImage,
  defaultVirtualDesktopImage,
  dockerDesktopDockerfile,
  virtualDesktopDockerfile
} from "./lib/docker-desktop-computer.js";
export {
  BrowserAutomify,
  createBrowserAutomify,
  withBrowserAutomify
} from "./lib/browser-automify.js";
export { initAutomify } from "./lib/init.js";
export { createModelAdapter } from "./lib/model-adapter.js";
export {
  computerCall,
  defaultAdapterScenarios,
  functionCall,
  getComputerTool,
  getFunctionOutputs,
  getInputText,
  getLastComputerScreenshot,
  getOutputText,
  getTool,
  message,
  parseOutputJson,
  parseDataUrl,
  response,
  runCommandCall,
  testModelAdapter,
  toDataUrl
} from "./lib/adapter-toolkit.js";
export { jsonOutput } from "./lib/output.js";
export {
  DockerComputerAutomify,
  LocalComputerAutomify,
  createComputerAutomify,
  createDockerComputerAutomify,
  createLocalComputerAutomify
} from "./lib/computer-automify.js";
export {
  CliAutomify,
  createCliAutomify,
  runShellCommand
} from "./lib/cli-automify.js";
export {
  DockerCliAutomify,
  DockerCliSession,
  createDockerCliAutomify,
  DockerVirtualCliSession,
  VirtualCliAutomify,
  createVirtualCliAutomify
} from "./lib/docker-cli-automify.js";
export {
  fileToEvaluate,
  fileToData,
  filesToEvaluate,
  filesToData
} from "./lib/file-data.js";
export { argumentReference } from "./lib/argument-reference.js";
