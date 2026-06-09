export type ComputerUseEnvironment = "browser" | "mac" | "windows" | "ubuntu" | string;

export type ComputerAction =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle" | string }
  | { type: "double_click"; x: number; y: number; button?: "left" | "right" | "middle" | string }
  | { type: "scroll"; x: number; y: number; scroll_x?: number; scroll_y?: number }
  | { type: "keypress"; keys: string[] }
  | { type: "type"; text: string }
  | { type: "wait" }
  | { type: "screenshot" }
  | { type: "move"; x: number; y: number }
  | { type: "drag"; x: number; y: number; path?: Array<{ x: number; y: number }> }
  | { type: string; [key: string]: unknown };

export type Screenshot = string | ArrayBuffer | Uint8Array | Buffer;
export type DomainRule = string | RegExp | ((url: URL) => boolean);
export type CommandRule = string | RegExp | ((command: string) => boolean);
export type DebugLogger = boolean | ((message: string, details?: unknown) => void);
export type ScreenshotDetail = "auto" | "low" | "high" | "original" | string;
export type BrowserPreset = "browser-review";
export type CliPreset = "repo" | "locked-down-cli";
export type DockerCliPreset = CliPreset;
export type DockerDesktopPreset = "desktop-review";
export type VirtualCliPreset = CliPreset;
export type VirtualDesktopPreset = "desktop-review";
export interface ArgumentReferenceEntry {
  surface: string;
  preferred: string[];
  notes: string;
}
export type OutputFormat =
  | { type: "text" }
  | { type: "json_object"; parse?: boolean }
  | {
      type: "json_schema";
      name: string;
      schema: Record<string, unknown>;
      description?: string;
      strict?: boolean;
      parse?: boolean;
    };

export interface ViewportOptions {
  width?: number;
  height?: number;
  depth?: number;
}

export interface DockerContainerOptions {
  docker?: string;
  dockerCommand?: string;
  image?: string;
  name?: string;
  existing?: boolean;
  keep?: boolean;
  autoRemove?: boolean;
  sandbox?: boolean;
  readOnly?: boolean;
  network?: string | false;
  cpus?: number | string;
  memory?: number | string;
  memorySwap?: number | string;
  cpuShares?: number;
  cpusetCpus?: string;
  pidsLimit?: number;
  shmSize?: string;
  tmpfsTmp?: string;
  tmpfsRun?: string;
  volumes?: string[];
  env?: string[];
  timeoutMs?: number;
  cwd?: string;
  workdir?: string;
  startupCommand?: string;
  packages?: string[];
  additionalAptPackages?: string[];
  installDependencies?: boolean;
}

export type JsonOutputShape = Record<
  string,
  "string" | "number" | "integer" | "boolean" | "object" | "array" | "null" | Record<string, unknown>
>;

export interface JsonOutputOptions {
  description?: string;
  strict?: boolean;
  parse?: boolean;
}

export function jsonOutput(
  name: string,
  shape: JsonOutputShape | Record<string, unknown>,
  options?: JsonOutputOptions
): OutputFormat;

export interface ComputerAdapter {
  displayWidth?: number;
  displayHeight?: number;
  environment?: ComputerUseEnvironment;
  instructions?: string;
  execute(action: ComputerAction, context: Record<string, unknown>): Promise<void> | void;
  screenshot(context?: Record<string, unknown>): Promise<Screenshot> | Screenshot;
  currentUrl?(): Promise<string | null | undefined> | string | null | undefined;
  close?(): Promise<void> | void;
}

export interface AutomifyOptions {
  openaiApiKey?: string;
  client?: ModelAdapter;
  computer: ComputerAdapter;
  model?: string;
  baseURL?: string;
  fetchImpl?: typeof fetch;
  maxSteps?: number;
  limits?: RunLimitsOptions;
  requestOptions?: Record<string, unknown>;
  viewport?: ViewportOptions;
  displayWidth?: number;
  displayHeight?: number;
  environment?: ComputerUseEnvironment;
  reasoning?: Record<string, unknown>;
  safety?: DoSafetyOptions;
  safetyIdentifier?: string;
  allowedDomains?: DomainRule[];
  hooks?: DoHooksOptions<AutomifyCompleteEvent>;
  onStep?: (event: Record<string, unknown>) => Promise<void> | void;
  onRequest?: (payload: Record<string, unknown>, meta: Record<string, unknown>) => Promise<void> | void;
  onResponse?: (response: Record<string, unknown>, meta: Record<string, unknown>) => Promise<void> | void;
  onComplete?: (event: AutomifyCompleteEvent) => Promise<void> | void;
  screenshot?: DoScreenshotOptions;
  redactScreenshot?: (screenshot: Screenshot, context: Record<string, unknown>) => Promise<Screenshot> | Screenshot;
  screenshotDetail?: ScreenshotDetail;
  screenshotMaxWidth?: number | false;
  screenshotMaxHeight?: number | false;
  screenshotResize?: (
    screenshot: Screenshot,
    target: { width: number; height: number }
  ) => Promise<Screenshot> | Screenshot;
  sendInitialScreenshot?: boolean;
  initialScreenshot?: string;
  finalScreenshot?: string;
  actionScreenshots?: string;
  screenshots?: DoScreenshotsOptions;
  trace?: boolean;
  silent?: boolean;
  debug?: DebugLogger;
  /**
   * Append automation debug events as JSON Lines to this file.
   */
  logFile?: string;
}

export interface BrowserAutomifyOptions extends Omit<AutomifyOptions, "computer">, BrowserComputerOptions {
  preset?: BrowserPreset;
  computer?: BrowserComputer;
}

export type DockerComputerAutomifyOptions = Omit<AutomifyOptions, "computer"> &
  DockerDesktopComputerOptions & {
    computer?: ComputerAdapter & { session: DockerDesktopSession; sharedFolder?: VirtualSharedFolderData };
  };

export type VirtualComputerAutomifyOptions = Omit<AutomifyOptions, "computer"> &
  VirtualDesktopComputerOptions & {
    computer?: ComputerAdapter & { session: QemuDesktopSession; sharedFolder?: VirtualSharedFolderData };
  };

export interface LocalComputerAutomifyOptions extends Omit<AutomifyOptions, "computer">, LocalDesktopComputerOptions {
  computer?: ComputerAdapter;
}

export interface LocalDesktopComputerOptions {
  nut?: Record<string, unknown>;
  viewport?: ViewportOptions;
  displayWidth?: number;
  displayHeight?: number;
  environment?: ComputerUseEnvironment;
  waitMs?: number;
  actionDelayMs?: number;
  instructions?: string;
  screenshotPath?: string;
  /**
   * Screenshot pixels per native mouse coordinate. On macOS Retina displays the
   * default is inferred as 2; use 1 for non-Retina external displays.
   */
  pixelScale?: number;
  mouseScaleX?: number;
  mouseScaleY?: number;
  mouseOffsetX?: number;
  mouseOffsetY?: number;
  mouseAutoDelayMs?: number;
  keyboardAutoDelayMs?: number;
  mouse?: {
    scaleX?: number;
    scaleY?: number;
    offsetX?: number;
    offsetY?: number;
    autoDelayMs?: number;
    speed?: number;
    smooth?: boolean;
    configure?: boolean;
  };
  keyboard?: {
    autoDelayMs?: number;
    configure?: boolean;
  };
  calibration?: {
    pixelScale?: number;
    mouseScaleX?: number;
    mouseScaleY?: number;
    mouseOffsetX?: number;
    mouseOffsetY?: number;
    screenshot?: boolean;
    required?: boolean;
  };
  /**
   * Linux only. Defaults to true when DISPLAY is missing. Starts Xvfb so the
   * local nut.js desktop adapter can run on headless servers. Linux local
   * desktop capture is X11-based; Wayland sessions are not supported.
   */
  virtualDisplay?:
    | boolean
    | {
        display?: string;
        width?: number;
        height?: number;
        depth?: number;
        command?: string;
        args?: string[];
        startupMs?: number;
      };
  /**
   * Linux only. Forces Xvfb even when DISPLAY is already set. Ignored on macOS
   * and Windows. Use this when the host Linux session is Wayland or otherwise
   * unsuitable for X11 screenshot capture.
   */
  forceVirtualDisplay?: boolean;
  display?:
    | string
    | {
        width?: number;
        height?: number;
        pixelScale?: number;
      };
  virtualDisplayDisplay?: string;
  virtualDisplayWidth?: number;
  virtualDisplayHeight?: number;
  virtualDisplayDepth?: number;
  virtualDisplayCommand?: string;
  virtualDisplayArgs?: string[];
  virtualDisplayStartupMs?: number;
  mouseSpeed?: number;
  smoothMouseMove?: boolean;
  configureMouse?: boolean;
  configureKeyboard?: boolean;
  macCommandTabHoldMs?: number;
  macCommandTabSettleMs?: number;
  silent?: boolean;
  debug?: DebugLogger;
  /**
   * Append local desktop adapter debug events as JSON Lines to this file.
   */
  logFile?: string;
  macosDisplayInfo?:
    | false
    | {
        width?: number;
        height?: number;
        visibleX?: number;
        visibleY?: number;
        visibleWidth?: number;
        visibleHeight?: number;
        backingScaleFactor?: number;
      };
  calibrateScreenshot?: boolean;
  /**
   * Defaults to true. When true, createLocalDesktopComputer() verifies screenshot
   * capture during setup so bad macOS Screen Recording/Accessibility grants fail
   * before the model starts producing desktop coordinates.
   */
  requireCalibration?: boolean;
  screenshot?: (context?: Record<string, unknown>) => Promise<Screenshot> | Screenshot;
  onUnknownAction?: (action: ComputerAction, context?: Record<string, unknown>) => Promise<void> | void;
}

export interface DockerDesktopOptions {
  startupCommand: string;
  windowManagerCommand?: string;
  packages?: string[];
  additionalAptPackages?: string[];
  installDependencies?: boolean;
  packageManager?: "apt" | string;
}

interface DockerDesktopComputerBaseOptions {
  preset?: DockerDesktopPreset;
  container?: DockerContainerOptions;
  dockerCommand?: string;
  image?: string;
  containerName?: string;
  existingContainer?: boolean;
  keepContainer?: boolean;
  start?: boolean;
  display?: string;
  viewport?: ViewportOptions;
  displayWidth?: number;
  displayHeight?: number;
  displayDepth?: number;
  environment?: ComputerUseEnvironment;
  instructions?: string;
  desktop?: DockerDesktopOptions;
  /**
   * Required command launched after Xvfb and the window manager.
   */
  startupCommand?: string;
  windowManagerCommand?: string;
  /**
   * Defaults to false so startup failures can include Docker logs. Set true to
   * ask Docker to remove the container automatically when the process exits.
   */
  autoRemove?: boolean;
  /**
   * Defaults to true for prepared images. It is relaxed automatically while
   * installDependencies is true because apt needs normal root capabilities.
   */
  sandbox?: boolean;
  /**
   * Defaults to true for apt-based base distro images such as
   * debian:bookworm-slim or ubuntu:24.04, and false for custom images. When true, the container
   * installs the desktop packages before starting Xvfb.
   */
  installDependencies?: boolean;
  /**
   * Replaces the default desktop package set. Use additionalAptPackages when you
   * only need to add tools such as chromium.
   */
  desktopPackages?: string[];
  /**
   * Extra apt packages installed alongside the default desktop packages while
   * installDependencies is true.
   */
  additionalAptPackages?: string[];
  /**
   * Docker network used for the container. Defaults to "bridge"; pass false or
   * "none" when the image does not need network access.
   */
  network?: string | false;
  cpus?: number | string;
  memory?: number | string;
  memorySwap?: number | string;
  cpuShares?: number;
  cpusetCpus?: string;
  /**
   * Either "apt" for Debian/Ubuntu images or a shell snippet that installs the
   * required desktop packages for another distro.
   */
  packageManager?: "apt" | string;
  readOnly?: boolean;
  pidsLimit?: number;
  shmSize?: string;
  tmpfsTmp?: string;
  tmpfsRun?: string;
  volumes?: string[];
  env?: string[];
  shared?: VirtualSharedFolderInput;
  sharedFolder?: VirtualSharedFolderInput;
  sharedFiles?: VirtualSharedFileInput[];
  files?: VirtualSharedFileInput[];
  waitMs?: number;
  startupTimeoutMs?: number;
  dockerTimeoutMs?: number;
  screenshotMaxBuffer?: number;
  logsMaxBuffer?: number;
  execFile?: (...args: unknown[]) => Promise<{ stdout?: Buffer | string; stderr?: Buffer | string }>;
  silent?: boolean;
  debug?: DebugLogger;
  /**
   * Append Docker desktop adapter debug events as JSON Lines to this file.
   */
  logFile?: string;
  onUnknownAction?: (action: ComputerAction, context?: Record<string, unknown>) => Promise<void> | void;
}

export type DockerDesktopComputerOptions =
  | (DockerDesktopComputerBaseOptions & { startupCommand: string })
  | (DockerDesktopComputerBaseOptions & { desktop: DockerDesktopOptions });

export interface QemuSshOptions {
  command?: string;
  host?: string;
  port?: number;
  user?: string;
  keyPath?: string;
  options?: string[];
  timeoutMs?: number;
  sudo?: boolean;
}

export interface QemuVmOptions {
  qemu?: string;
  qemuCommand?: string;
  qemuImgCommand?: string;
  imageCacheDir?: string;
  imageUrl?: string;
  defaultImageCache?: QemuDefaultImageCacheOptions;
  image?: string;
  diskImage?: string;
  diskFormat?: "qcow2" | "raw" | string;
  name?: string;
  existing?: boolean;
  keep?: boolean;
  memory?: number | string;
  cpus?: number | string;
  accel?: "hvf" | "kvm" | "whpx" | "tcg" | string;
  machine?: string;
  cpu?: string;
  firmware?: string;
  network?: boolean;
  networkDevice?: string;
  extraArgs?: string[];
  timeoutMs?: number;
}

export type QemuDefaultImageCacheOptions =
  | boolean
  | {
      /**
       * Cache root for the downloaded base image and prepared image subdirectory.
       */
      dir?: string;
      /**
       * Cache directory for downloaded base images. Defaults to dir when provided.
       */
      imageCacheDir?: string;
      /**
       * Cache directory for Automify-ready prepared images. Defaults to `${dir}/prepared`.
       */
      preparedDir?: string;
      /**
       * Defaults to true. When true, Automify caches a booted Debian image with
       * the automify SSH user already provisioned, then creates runtime overlays
       * from that image.
       */
      prepared?: boolean;
      /**
       * Re-download the Debian base qcow2 and rebuild the prepared image.
       */
      forceDownload?: boolean;
      /**
       * Rebuild the prepared image even if one already exists.
       */
      forcePrepare?: boolean;
    };

export interface VirtualDesktopComputerBaseOptions {
  preset?: VirtualDesktopPreset;
  vm?: QemuVmOptions;
  qemuCommand?: string;
  qemuImgCommand?: string;
  qemuImageCacheDir?: string;
  qemuImageUrl?: string;
  defaultImageCache?: QemuDefaultImageCacheOptions;
  image?: string;
  diskImage?: string;
  diskFormat?: "qcow2" | "raw" | string;
  vmName?: string;
  existingVM?: boolean;
  keepVM?: boolean;
  start?: boolean;
  ssh?: QemuSshOptions;
  sshCommand?: string;
  sshKeygenCommand?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshKeyPath?: string;
  sshOptions?: string[];
  sshTimeoutMs?: number;
  sudo?: boolean;
  display?: string;
  viewport?: ViewportOptions;
  displayWidth?: number;
  displayHeight?: number;
  displayDepth?: number;
  environment?: ComputerUseEnvironment;
  instructions?: string;
  desktop?: DockerDesktopOptions;
  startupCommand?: string;
  windowManagerCommand?: string;
  installDependencies?: boolean;
  desktopPackages?: string[];
  additionalAptPackages?: string[];
  memory?: number | string;
  cpus?: number | string;
  accel?: "hvf" | "kvm" | "whpx" | "tcg" | string;
  machine?: string;
  cpu?: string;
  firmware?: string;
  network?: boolean;
  networkDevice?: string;
  extraQemuArgs?: string[];
  shared?: VirtualSharedFolderInput;
  sharedFolder?: VirtualSharedFolderInput;
  sharedFiles?: VirtualSharedFileInput[];
  files?: VirtualSharedFileInput[];
  sharedMode?: "virtfs" | "none" | string;
  sharedTag?: string;
  sharedSecurityModel?: string;
  waitMs?: number;
  startupTimeoutMs?: number;
  qemuTimeoutMs?: number;
  commandTimeoutMs?: number;
  screenshotMaxBuffer?: number;
  screenshotSettleMs?: number;
  fetchImpl?: typeof fetch;
  execFile?: (...args: unknown[]) => Promise<{ stdout?: Buffer | string; stderr?: Buffer | string }>;
  spawn?: (...args: unknown[]) => unknown;
  silent?: boolean;
  debug?: DebugLogger;
  logFile?: string;
  onUnknownAction?: (action: ComputerAction, context?: Record<string, unknown>) => Promise<void> | void;
}

export type VirtualDesktopComputerOptions =
  | (VirtualDesktopComputerBaseOptions & { startupCommand: string })
  | (VirtualDesktopComputerBaseOptions & { desktop: DockerDesktopOptions });

export type VirtualSharedFolderInput =
  | true
  | string
  | {
      hostPath?: string;
      path?: string;
      containerPath?: string;
      readOnly?: boolean;
      cleanup?: boolean;
      files?: VirtualSharedFileInput[];
    };

export type VirtualSharedFileInput =
  | string
  | {
      path: string;
      name?: string;
      targetPath?: string;
    };

export interface VirtualSharedFolderData {
  hostPath: string;
  containerPath: string;
  files: Array<{
    name: string;
    relativePath: string;
    hostPath: string;
    containerPath: string;
    size: number;
  }>;
}

export class DockerDesktopSession {
  constructor(options?: DockerDesktopComputerOptions);
  readonly name: string;
  readonly display: string;
  readonly width: number;
  readonly height: number;
  start(): Promise<void>;
  execute(action: ComputerAction): Promise<void>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}

export class QemuDesktopSession {
  constructor(options?: VirtualDesktopComputerOptions);
  readonly name: string;
  readonly display: string;
  readonly width: number;
  readonly height: number;
  start(): Promise<void>;
  execute(action: ComputerAction): Promise<void>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}

export interface OpenAIProviderConfig {
  type: "openai";
  apiKey: string;
  model: string;
  computerModel?: string;
  baseURL?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface AnthropicProviderConfig extends Omit<AnthropicModelAdapterOptions, "anthropicApiKey"> {
  type: "anthropic";
  apiKey: string;
  model: string;
}

export interface CustomProviderConfig {
  type: "custom";
  model: string;
  adapter?: ModelAdapterInput;
  client?: ModelAdapter;
  options?: Record<string, unknown>;
}

export type ProviderConfig = OpenAIProviderConfig | AnthropicProviderConfig | CustomProviderConfig;

export interface InitAutomifyOptions {
  provider: ProviderConfig;
  computerModel?: string;
  maxSteps?: number;
  limits?: RunLimitsOptions;
  requestOptions?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  safety?: DoSafetyOptions;
  safetyIdentifier?: string;
  allowedDomains?: DomainRule[];
  hooks?: DoHooksOptions;
  onStep?: (event: Record<string, unknown>) => Promise<void> | void;
  onRequest?: (payload: Record<string, unknown>, meta: Record<string, unknown>) => Promise<void> | void;
  onResponse?: (response: Record<string, unknown>, meta: Record<string, unknown>) => Promise<void> | void;
  onComplete?: (event: AutomifyCompleteEvent | CliAutomifyCompleteEvent) => Promise<void> | void;
  screenshot?: DoScreenshotOptions;
  redactScreenshot?: (screenshot: Screenshot, context: Record<string, unknown>) => Promise<Screenshot> | Screenshot;
  screenshotDetail?: ScreenshotDetail;
  screenshotMaxWidth?: number | false;
  screenshotMaxHeight?: number | false;
  screenshotResize?: (
    screenshot: Screenshot,
    target: { width: number; height: number }
  ) => Promise<Screenshot> | Screenshot;
  sendInitialScreenshot?: boolean;
  initialScreenshot?: string;
  finalScreenshot?: string;
  actionScreenshots?: string;
  screenshots?: DoScreenshotsOptions;
  trace?: boolean;
  silent?: boolean;
  debug?: DebugLogger;
}

export interface DoOptions {
  data?: Record<string, unknown>;
  evaluate?: FileToEvaluateInput | FileToEvaluateInput[];
  filesToEvaluate?: FileToEvaluateInput | FileToEvaluateInput[];
  model?: string;
  maxSteps?: number;
  limits?: RunLimitsOptions;
  request?: Record<string, unknown>;
  requestOptions?: Record<string, unknown>;
  output?: OutputFormat;
  displayWidth?: number;
  displayHeight?: number;
  environment?: ComputerUseEnvironment;
  reasoning?: Record<string, unknown>;
  safety?: DoSafetyOptions;
  safetyIdentifier?: string;
  allowedDomains?: DomainRule[];
  hooks?: DoHooksOptions<AutomifyCompleteEvent>;
  onStep?: (event: Record<string, unknown>) => Promise<void> | void;
  onComplete?: (event: AutomifyCompleteEvent) => Promise<void> | void;
  screenshot?: DoScreenshotOptions;
  redactScreenshot?: (screenshot: Screenshot, context: Record<string, unknown>) => Promise<Screenshot> | Screenshot;
  screenshotDetail?: ScreenshotDetail;
  screenshotMaxWidth?: number | false;
  screenshotMaxHeight?: number | false;
  screenshotResize?: (
    screenshot: Screenshot,
    target: { width: number; height: number }
  ) => Promise<Screenshot> | Screenshot;
  sendInitialScreenshot?: boolean;
  initialScreenshot?: string;
  finalScreenshot?: string;
  actionScreenshots?: string;
  screenshots?: DoScreenshotsOptions;
  trace?: boolean;
  silent?: boolean;
  onSafetyCheck?: (event: {
    checks: Array<Record<string, unknown>>;
    action: ComputerAction;
    call: Record<string, unknown>;
    response: Record<string, unknown>;
  }) => Promise<boolean> | boolean;
}

export interface RunLimitsOptions {
  steps?: number;
  maxSteps?: number;
}

export interface DoScreenshotsOptions {
  initial?: string;
  final?: string;
  actions?: string;
  actionScreenshots?: string;
}

export interface DoScreenshotOptions {
  detail?: ScreenshotDetail;
  maxWidth?: number | false;
  maxHeight?: number | false;
  sendInitialScreenshot?: boolean;
  resize?: (screenshot: Screenshot, target: { width: number; height: number }) => Promise<Screenshot> | Screenshot;
  redact?: (screenshot: Screenshot, context: Record<string, unknown>) => Promise<Screenshot> | Screenshot;
}

export interface DoSafetyOptions {
  identifier?: string;
  safetyIdentifier?: string;
  domains?: DomainRule[];
  allowedDomains?: DomainRule[];
  onCheck?: DoOptions["onSafetyCheck"];
  onSafetyCheck?: DoOptions["onSafetyCheck"];
}

export interface DoHooksOptions<CompleteEvent = AutomifyCompleteEvent | CliAutomifyCompleteEvent> {
  step?: (event: Record<string, unknown>) => Promise<void> | void;
  onStep?: (event: Record<string, unknown>) => Promise<void> | void;
  complete?: (event: CompleteEvent) => Promise<void> | void;
  onComplete?: (event: CompleteEvent) => Promise<void> | void;
}

export interface CliCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean | string;
  timeoutMs?: number;
  timeout?: number;
  approval?: "always" | "never";
  allow?: CommandRule[];
  allowed?: CommandRule[];
  allowedCommands?: CommandRule[];
  block?: CommandRule[];
  blocked?: CommandRule[];
  blockedCommands?: CommandRule[];
  confirm?: CliAutomifyOptions["confirmCommand"];
  confirmCommand?: CliAutomifyOptions["confirmCommand"];
}

export interface AutomifyResult {
  response: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  trace?: Array<Record<string, unknown>>;
  ok: boolean;
  status: "succeeded";
  completed: boolean;
  stopReason: "done";
  text: string;
  parsed?: unknown;
  finalScreenshot?: {
    path: string;
    bytes?: number;
  };
}

export interface AutomifyCompleteEvent {
  instruction: string;
  data: Record<string, unknown>;
  result: AutomifyResult;
  response: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  ok: boolean;
  status: "succeeded";
  completed: boolean;
  stopReason: "done";
  surface: "browser" | "desktop" | "computer" | string;
}

export class Automify {
  constructor(options: AutomifyOptions);
  do(instruction: string, options?: DoOptions): Promise<AutomifyResult>;
  task(options?: DoOptions): AutomifyTask;
  addStep(instruction: string, options?: TaskStepOptions): AutomifyTask;
  addWait(conditionOrMs?: string | number, options?: TaskStepOptions): AutomifyTask;
}

export function createAutomify(options: AutomifyOptions): Automify;

export interface TaskStepOptions {
  label?: string;
  notes?: string;
}

export class AutomifyTask {
  constructor(automify: Automify, options?: DoOptions);
  addStep(instruction: string, options?: TaskStepOptions): this;
  step(instruction: string, options?: TaskStepOptions): this;
  addWait(conditionOrMs?: string | number, options?: TaskStepOptions): this;
  wait(conditionOrMs?: string | number, options?: TaskStepOptions): this;
  addObserve(instruction: string, options?: TaskStepOptions): this;
  observe(instruction: string, options?: TaskStepOptions): this;
  addExtract(instruction: string, options?: TaskStepOptions): this;
  extract(instruction: string, options?: TaskStepOptions): this;
  addAssert(instruction: string, options?: TaskStepOptions): this;
  assert(instruction: string, options?: TaskStepOptions): this;
  addData(data: Record<string, unknown> | unknown): this;
  withData(data: Record<string, unknown> | unknown): this;
  withOptions(options?: DoOptions): this;
  toInstruction(): string;
  run(options?: DoOptions): Promise<AutomifyResult>;
  do(options?: DoOptions): Promise<AutomifyResult>;
}

export function createTask(automify: Automify, options?: DoOptions): AutomifyTask;

export function createComputerAutomify(options: AutomifyOptions): Automify;

export interface InitializedAutomify {
  client: ModelAdapter;
  browser(options?: Omit<BrowserAutomifyOptions, "openaiApiKey" | "client">): Promise<BrowserAutomify>;
  withBrowser<T>(
    options: Omit<BrowserAutomifyOptions, "openaiApiKey" | "client">,
    run: (automify: BrowserAutomify) => Promise<T> | T
  ): Promise<T>;
  cli(options?: Omit<CliAutomifyOptions, "openaiApiKey" | "client">): CliAutomify;
  dockerCli(options?: Omit<DockerCliAutomifyOptions, "openaiApiKey" | "client">): DockerCliAutomify;
  dockerComputer(
    options?: Omit<DockerComputerAutomifyOptions, "openaiApiKey" | "client">
  ): Promise<DockerComputerAutomify>;
  localComputer(
    options?: Omit<LocalComputerAutomifyOptions, "openaiApiKey" | "client">
  ): Promise<LocalComputerAutomify>;
  virtualComputer(
    options?: Omit<VirtualComputerAutomifyOptions, "openaiApiKey" | "client">
  ): Promise<VirtualComputerAutomify>;
  virtualCli(options?: Omit<VirtualCliAutomifyOptions, "openaiApiKey" | "client">): VirtualCliAutomify;
  computer(options: Omit<AutomifyOptions, "openaiApiKey" | "client">): Automify;
  custom(options: Omit<AutomifyOptions, "openaiApiKey" | "client">): Automify;
}

export function initAutomify(options: InitAutomifyOptions): InitializedAutomify;

export interface ModelAdapter {
  createResponse(payload: Record<string, unknown>, context?: ModelAdapterContext): Promise<Record<string, unknown>>;
}

export interface RespondModelAdapter {
  respond(payload: Record<string, unknown>, context?: ModelAdapterContext): Promise<Record<string, unknown>>;
}

export interface ModelAdapterFactory {
  options?: Record<string, unknown>;
  create(options?: Record<string, unknown>): ModelAdapter | RespondModelAdapter;
}

export type ModelAdapterInput =
  | ModelAdapter
  | RespondModelAdapter
  | ModelAdapterFactory
  | ((options?: Record<string, unknown>) => ModelAdapter | RespondModelAdapter | ModelAdapterFactory);

export interface ModelAdapterContext {
  phase?: string;
  surface?: "computer" | "cli" | string;
  step?: number;
  requestOptions?: Record<string, unknown>;
}

export function createModelAdapter(adapter: ModelAdapterInput): ModelAdapter;

export function response(options?: {
  id?: string;
  output?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}): Record<string, unknown>;
export function message(text: string, options?: Record<string, unknown>): Record<string, unknown>;
export function computerCall(action: ComputerAction, options?: Record<string, unknown>): Record<string, unknown>;
export function runCommandCall(command: string, options?: Record<string, unknown>): Record<string, unknown>;
export function functionCall(
  name: string,
  args?: Record<string, unknown> | string,
  options?: Record<string, unknown>
): Record<string, unknown>;
export function getInputText(payload: Record<string, unknown>): string;
export function getTool(payload: Record<string, unknown>, typeOrName: string): Record<string, unknown> | null;
export function getComputerTool(payload: Record<string, unknown>): Record<string, unknown> | null;
export function getLastComputerScreenshot(payload: Record<string, unknown>): {
  mediaType: string;
  base64: string;
  buffer: Buffer;
} | null;
export function getFunctionOutputs(payload: Record<string, unknown>): Array<{ callId: string; output: unknown }>;
export function getOutputText(response: Record<string, unknown>): string;
export function parseOutputJson(response: Record<string, unknown>): unknown;
export function parseDataUrl(value: string): { mediaType: string; base64: string; buffer: Buffer };
export function toDataUrl(input: Screenshot, mediaType?: string): string;
export function testModelAdapter(adapter: ModelAdapterInput, scenarios?: Array<Record<string, unknown>>): Promise<void>;
export function defaultAdapterScenarios(): Array<Record<string, unknown>>;

export class BrowserAutomify extends Automify {
  browser: unknown;
  context: unknown;
  page: unknown;
  goto(url: string, gotoOptions?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export class DockerComputerAutomify extends Automify {
  session: DockerDesktopSession;
  sharedFolder?: VirtualSharedFolderData;
  close(): Promise<void>;
}

export class VirtualComputerAutomify extends Automify {
  session: QemuDesktopSession;
  sharedFolder?: VirtualSharedFolderData;
  close(): Promise<void>;
}

export class LocalComputerAutomify extends Automify {
  close(): Promise<void>;
}

export function createBrowserAutomify(options: BrowserAutomifyOptions): Promise<BrowserAutomify>;
export function withBrowserAutomify<T>(
  options: BrowserAutomifyOptions,
  run: (automify: BrowserAutomify) => Promise<T> | T
): Promise<T>;
export function createDockerComputerAutomify(options?: DockerComputerAutomifyOptions): Promise<DockerComputerAutomify>;
export function createVirtualComputerAutomify(
  options?: VirtualComputerAutomifyOptions
): Promise<VirtualComputerAutomify>;
export function createLocalComputerAutomify(options?: LocalComputerAutomifyOptions): Promise<LocalComputerAutomify>;

export function createLocalDesktopComputer(options?: LocalDesktopComputerOptions): Promise<ComputerAdapter>;
export function executeLocalDesktopAction(action: ComputerAction, options?: LocalDesktopComputerOptions): Promise<void>;
export function captureLocalDesktopScreenshot(options?: LocalDesktopComputerOptions): Promise<Screenshot>;
export const argumentReference: ArgumentReferenceEntry[];
export function createDockerDesktopComputer(
  options?: DockerDesktopComputerOptions
): Promise<ComputerAdapter & { session: DockerDesktopSession; sharedFolder?: VirtualSharedFolderData }>;
export function createVirtualDesktopComputer(
  options?: VirtualDesktopComputerOptions
): Promise<ComputerAdapter & { session: QemuDesktopSession; sharedFolder?: VirtualSharedFolderData }>;
export function defaultDockerDesktopImage(): string;
export function defaultVirtualDesktopImage(): string;
export function dockerDesktopDockerfile(): string;

export interface CliAutomifyOptions extends Omit<InitAutomifyOptions, "model" | "onComplete"> {
  preset?: CliPreset;
  model?: string;
  command?: CliCommandOptions;
  commands?: CliCommandOptions;
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean | string;
  timeoutMs?: number;
  maxSteps?: number;
  requestOptions?: Record<string, unknown>;
  runner?: (
    command: string,
    options: { cwd?: string; env?: Record<string, string>; shell?: boolean | string; timeoutMs?: number }
  ) => Promise<Record<string, unknown>>;
  confirmCommand?: (event: {
    command: { command: string; cwd?: string; timeoutMs?: number };
    call: Record<string, unknown>;
    response: Record<string, unknown>;
  }) => Promise<boolean> | boolean;
  approval?: "always" | "never";
  allowedCommands?: CommandRule[];
  blockedCommands?: CommandRule[];
  onStep?: (event: Record<string, unknown>) => Promise<void> | void;
  onRequest?: (payload: Record<string, unknown>, meta: Record<string, unknown>) => Promise<void> | void;
  onResponse?: (response: Record<string, unknown>, meta: Record<string, unknown>) => Promise<void> | void;
  onComplete?: (event: CliAutomifyCompleteEvent) => Promise<void> | void;
  silent?: boolean;
  debug?: DebugLogger;
  /**
   * Append CLI debug events as JSON Lines to this file.
   */
  logFile?: string;
  reasoning?: Record<string, unknown>;
  safetyIdentifier?: string;
}

export interface CliDoOptions {
  data?: Record<string, unknown>;
  evaluate?: FileToEvaluateInput | FileToEvaluateInput[];
  filesToEvaluate?: FileToEvaluateInput | FileToEvaluateInput[];
  model?: string;
  maxSteps?: number;
  limits?: RunLimitsOptions;
  request?: Record<string, unknown>;
  requestOptions?: Record<string, unknown>;
  output?: OutputFormat;
  command?: CliCommandOptions;
  commands?: CliCommandOptions;
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean | string;
  timeoutMs?: number;
  approval?: "always" | "never";
  allowedCommands?: CommandRule[];
  blockedCommands?: CommandRule[];
  instructions?: string;
  confirmCommand?: CliAutomifyOptions["confirmCommand"];
  hooks?: DoHooksOptions<CliAutomifyCompleteEvent>;
  onStep?: (event: Record<string, unknown>) => Promise<void> | void;
  onComplete?: (event: CliAutomifyCompleteEvent) => Promise<void> | void;
  reasoning?: Record<string, unknown>;
  safetyIdentifier?: string;
  silent?: boolean;
}

export type CliAutomifyDoOptions = CliDoOptions;

export interface CliAutomifyResult {
  response: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  ok: boolean;
  status: "succeeded";
  completed: boolean;
  stopReason: "done";
  text: string;
  parsed?: unknown;
}

export interface CliAutomifyCompleteEvent {
  instruction: string;
  data: Record<string, unknown>;
  result: CliAutomifyResult;
  response: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  ok: boolean;
  status: "succeeded";
  completed: boolean;
  stopReason: "done";
  surface: "cli";
}

export class CliAutomify {
  constructor(options: CliAutomifyOptions);
  do(instruction: string, options?: CliAutomifyDoOptions): Promise<CliAutomifyResult>;
}

export function createCliAutomify(options: CliAutomifyOptions): CliAutomify;
export function runShellCommand(
  command: string,
  options?: { cwd?: string; env?: Record<string, string>; shell?: boolean | string; timeoutMs?: number }
): Promise<Record<string, unknown>>;

export interface FileToDataOptions {
  format?: "text" | "metadata" | "base64" | "data_url" | "dataUrl" | "buffer";
  mediaType?: string;
  encoding?: BufferEncoding;
}

export interface FileToEvaluateOptions {
  mediaType?: string;
  encoding?: BufferEncoding;
  detail?: "auto" | "low" | "high" | string;
  maxBytes?: number;
}

export type FileToDataInput =
  | string
  | {
      path: string;
      name?: string;
      mediaType?: string;
      format?: FileToDataOptions["format"];
      encoding?: BufferEncoding;
    };

export type FileToEvaluateInput =
  | string
  | {
      path: string;
      name?: string;
      mediaType?: string;
      encoding?: BufferEncoding;
      detail?: FileToEvaluateOptions["detail"];
      maxBytes?: number;
    };

export function fileToData(file: FileToDataInput, options?: FileToDataOptions): Promise<Record<string, unknown>>;
export function filesToData(
  files: FileToDataInput | FileToDataInput[],
  options?: FileToDataOptions
): Promise<Array<Record<string, unknown>>>;
export function fileToEvaluate(
  file: FileToEvaluateInput,
  options?: FileToEvaluateOptions
): Promise<Record<string, unknown>>;
export function filesToEvaluate(
  files: FileToEvaluateInput | FileToEvaluateInput[],
  options?: FileToEvaluateOptions
): Promise<Array<Record<string, unknown>>>;

export interface DockerCliAutomifyOptions extends CliAutomifyOptions {
  preset?: DockerCliPreset;
  container?: DockerContainerOptions;
  dockerCommand?: string;
  image?: string;
  containerName?: string;
  existingContainer?: boolean;
  keepContainer?: boolean;
  workdir?: string;
  workspacePath?: string;
  containerCwd?: string;
  startupCommand?: string;
  packages?: string[];
  additionalAptPackages?: string[];
  installDependencies?: boolean;
  autoRemove?: boolean;
  sandbox?: boolean;
  readOnly?: boolean;
  network?: string | false;
  cpus?: number | string;
  memory?: number | string;
  memorySwap?: number | string;
  cpuShares?: number;
  cpusetCpus?: string;
  pidsLimit?: number;
  shmSize?: string;
  tmpfsTmp?: string;
  volumes?: string[];
  containerEnv?: string[];
  shared?: VirtualSharedFolderInput;
  sharedFolder?: VirtualSharedFolderInput;
  sharedFiles?: VirtualSharedFileInput[];
  files?: VirtualSharedFileInput[];
  dockerTimeoutMs?: number;
  commandMaxBuffer?: number;
  execFile?: (...args: unknown[]) => Promise<{ stdout?: Buffer | string; stderr?: Buffer | string }>;
}

export interface VirtualCliAutomifyOptions extends CliAutomifyOptions {
  preset?: VirtualCliPreset;
  session?: QemuCliSession;
  vm?: QemuVmOptions;
  qemuCommand?: string;
  qemuImgCommand?: string;
  qemuImageCacheDir?: string;
  qemuImageUrl?: string;
  defaultImageCache?: QemuDefaultImageCacheOptions;
  image?: string;
  diskImage?: string;
  diskFormat?: "qcow2" | "raw" | string;
  vmName?: string;
  existingVM?: boolean;
  keepVM?: boolean;
  workdir?: string;
  workspacePath?: string;
  guestCwd?: string;
  startupCommand?: string;
  packages?: string[];
  additionalAptPackages?: string[];
  installDependencies?: boolean;
  memory?: number | string;
  cpus?: number | string;
  accel?: "hvf" | "kvm" | "whpx" | "tcg" | string;
  machine?: string;
  cpu?: string;
  firmware?: string;
  network?: boolean;
  networkDevice?: string;
  extraQemuArgs?: string[];
  ssh?: QemuSshOptions;
  sshCommand?: string;
  sshKeygenCommand?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshKeyPath?: string;
  sshOptions?: string[];
  sshTimeoutMs?: number;
  sudo?: boolean;
  shared?: VirtualSharedFolderInput;
  sharedFolder?: VirtualSharedFolderInput;
  sharedFiles?: VirtualSharedFileInput[];
  files?: VirtualSharedFileInput[];
  sharedMode?: "virtfs" | "none" | string;
  sharedTag?: string;
  sharedSecurityModel?: string;
  startupTimeoutMs?: number;
  qemuTimeoutMs?: number;
  commandMaxBuffer?: number;
  execFile?: (...args: unknown[]) => Promise<{ stdout?: Buffer | string; stderr?: Buffer | string }>;
  spawn?: (...args: unknown[]) => unknown;
}

export class DockerCliSession {
  constructor(options?: DockerCliAutomifyOptions);
  readonly name: string;
  readonly cwd: string;
  readonly sharedFolder?: { data: VirtualSharedFolderData };
  start(): Promise<void>;
  run(
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }
  ): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export class DockerCliAutomify extends CliAutomify {
  session: DockerCliSession;
  readonly sharedFolder?: VirtualSharedFolderData;
  do(instruction: string, options?: CliAutomifyDoOptions): Promise<CliAutomifyResult>;
  close(): Promise<void>;
}

export function createDockerCliAutomify(options: DockerCliAutomifyOptions): DockerCliAutomify;
export class QemuCliSession {
  constructor(options?: VirtualCliAutomifyOptions);
  readonly name: string;
  readonly cwd: string;
  readonly sharedFolder?: { data: VirtualSharedFolderData };
  start(): Promise<void>;
  run(
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }
  ): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
export { QemuCliSession as QemuVirtualCliSession };

export class VirtualCliAutomify extends CliAutomify {
  session: QemuCliSession;
  readonly sharedFolder?: VirtualSharedFolderData;
  do(instruction: string, options?: CliAutomifyDoOptions): Promise<CliAutomifyResult>;
  close(): Promise<void>;
}

export function createVirtualCliAutomify(options: VirtualCliAutomifyOptions): VirtualCliAutomify;

export class OpenAIResponsesClient {
  constructor(options: {
    openaiApiKey?: string;
    baseURL?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  });
  createResponse(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface AnthropicModelAdapterOptions {
  anthropicApiKey?: string;
  baseURL?: string;
  version?: string;
  betas?: string | string[];
  fetchImpl?: typeof fetch;
  maxTokens?: number;
  computerToolType?: string;
  requestTransform?: (
    request: Record<string, unknown>,
    context: { payload: Record<string, unknown>; context?: ModelAdapterContext }
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  responseTransform?: (
    response: Record<string, unknown>,
    context: { payload: Record<string, unknown>; context?: ModelAdapterContext; request: Record<string, unknown> }
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export class AnthropicModelAdapter implements ModelAdapter {
  constructor(options: AnthropicModelAdapterOptions);
  createResponse(payload: Record<string, unknown>, context?: ModelAdapterContext): Promise<Record<string, unknown>>;
}

export function createAnthropicModelAdapter(options: AnthropicModelAdapterOptions): AnthropicModelAdapter;

export class AutomifyError extends Error {}
export class SafetyCheckError extends AutomifyError {
  checks: Array<Record<string, unknown>>;
  action: ComputerAction;
}
export class MaxStepsExceededError extends AutomifyError {
  maxSteps: number;
}

export interface BrowserComputerOptions {
  playwright?: Record<string, unknown>;
  browser?: "chromium" | "firefox" | "webkit" | string;
  browserName?: "chromium" | "firefox" | "webkit" | string;
  headless?: boolean;
  startUrl?: string;
  url?: string;
  viewport?: ViewportOptions;
  displayWidth?: number;
  displayHeight?: number;
  environment?: ComputerUseEnvironment;
  launch?: Record<string, unknown>;
  launchOptions?: Record<string, unknown>;
  context?: Record<string, unknown>;
  contextOptions?: Record<string, unknown>;
  navigation?: Record<string, unknown>;
  gotoOptions?: Record<string, unknown>;
  actionDelayMs?: number;
  waitMs?: number;
  instructions?: string;
  silent?: boolean;
  debug?: DebugLogger;
  /**
   * Append browser adapter debug events as JSON Lines to this file.
   */
  logFile?: string;
  onUnknownAction?: (action: ComputerAction) => Promise<void> | void;
}

export interface BrowserComputer extends ComputerAdapter {
  browser: unknown;
  context: unknown;
  page: unknown;
  goto(url: string, gotoOptions?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export function createBrowserComputer(options?: BrowserComputerOptions): Promise<BrowserComputer>;
export function createPlaywrightComputer(page: unknown, options?: Record<string, unknown>): ComputerAdapter;
export function executePlaywrightAction(
  page: unknown,
  action: ComputerAction,
  options?: Record<string, unknown>
): Promise<void>;
