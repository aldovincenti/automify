import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { AutomifyError } from "./errors.js";

const execFileAsync = promisify(execFileCallback);
const DEFAULT_RECORDING_FPS = 4;
const DEFAULT_RECORDING_TIMEOUT_MS = 120_000;

export async function startScreenRecording(input, context = {}) {
  const options = normalizeScreenRecordingOptions(input, context);
  if (!options) return null;

  await mkdir(dirname(options.path), { recursive: true });
  const framesDir =
    options.framesDir ??
    (await mkdtemp(join(tmpdir(), `automify-recording-${Date.now()}-${Math.random().toString(16).slice(2)}-`)));
  await mkdir(framesDir, { recursive: true });

  let frameCount = 0;
  let stopped = false;
  let captureTimer = null;
  let inFlight = Promise.resolve();

  const capture = async (force = false) => {
    if (stopped && !force) return;
    const frameNumber = frameCount + 1;
    const screenshot = await options.captureFrame({
      ...context,
      recording: true,
      frame: frameNumber
    });
    await writeFile(join(framesDir, `frame-${padFrame(frameNumber)}.png`), screenshotToBuffer(screenshot));
    frameCount = frameNumber;
  };

  const schedule = () => {
    captureTimer = setTimeout(() => {
      inFlight = inFlight.then(capture).catch((error) => {
        stopped = true;
        throw error;
      });
      if (!stopped) schedule();
    }, options.intervalMs);
  };

  inFlight = capture();
  schedule();

  return {
    path: options.path,
    framesDir,
    fps: options.fps,
    startedAt: new Date().toISOString(),
    async stop(stopContext = {}) {
      if (stopped && stopContext.force !== true) return null;
      stopped = true;
      clearTimeout(captureTimer);
      await inFlight;
      if (frameCount === 0) {
        await capture(true);
      }

      await encodeScreenRecording({
        ...options,
        framesDir
      });

      const size = await stat(options.path).catch(() => null);
      if (options.keepFrames !== true) {
        await rm(framesDir, { recursive: true, force: true }).catch(() => {});
      }

      return {
        path: options.path,
        bytes: size?.size,
        frames: frameCount,
        fps: options.fps,
        startedAt: this.startedAt,
        stoppedAt: new Date().toISOString()
      };
    }
  };
}

export function normalizeScreenRecordingOptions(input, context = {}) {
  if (input == null || input === false) return null;

  const raw =
    input === true || typeof input === "string"
      ? {
          path: typeof input === "string" ? input : undefined
        }
      : input;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AutomifyError("screenRecording must be true, a file path, or an options object.");
  }
  if (raw.enabled === false) return null;

  const fps = positiveNumber(raw.fps) ?? DEFAULT_RECORDING_FPS;
  const intervalMs = positiveNumber(raw.intervalMs ?? raw.captureIntervalMs) ?? Math.max(1, Math.round(1000 / fps));
  const captureFrame = raw.captureFrame ?? context.captureFrame;
  if (typeof captureFrame !== "function") {
    throw new AutomifyError("screenRecording requires a captureFrame function.");
  }

  return {
    ...raw,
    path: normalizeRecordingPath(raw.path),
    framesDir: normalizeOptionalPath(raw.framesDir),
    fps,
    intervalMs,
    captureFrame,
    keepFrames: raw.keepFrames === true,
    execFile: raw.execFile ?? execFileAsync,
    ffmpegCommand: raw.ffmpegCommand ?? raw.command ?? "ffmpeg",
    encodingTimeoutMs: positiveNumber(raw.encodingTimeoutMs ?? raw.timeoutMs) ?? DEFAULT_RECORDING_TIMEOUT_MS
  };
}

async function encodeScreenRecording(options) {
  const outputPattern = join(options.framesDir, "frame-%06d.png");
  const args = [
    "-y",
    "-framerate",
    String(options.fps),
    "-i",
    outputPattern,
    "-vf",
    `fps=${options.fps},format=yuv420p`,
    options.path
  ];

  try {
    await options.execFile(options.ffmpegCommand, args, {
      timeout: options.encodingTimeoutMs
    });
  } catch (error) {
    throw new AutomifyError(
      `Unable to encode screen recording with ${options.ffmpegCommand}. Install ffmpeg or pass screenRecording.execFile/ffmpegCommand.`,
      { cause: error }
    );
  }
}

function normalizeRecordingPath(path) {
  if (path == null || path === true) {
    return join(tmpdir(), `automify-recording-${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`);
  }
  if (typeof path !== "string" || path.trim() === "") {
    throw new AutomifyError("screenRecording.path must be a non-empty file path.");
  }
  return path;
}

function normalizeOptionalPath(path) {
  if (path == null) return undefined;
  if (typeof path !== "string" || path.trim() === "") {
    throw new AutomifyError("screenRecording.framesDir must be a non-empty directory path.");
  }
  return path;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function padFrame(value) {
  return String(value).padStart(6, "0");
}

function screenshotToBuffer(value) {
  if (typeof value === "string") {
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/s.exec(value);
    return Buffer.from(dataUrlMatch ? dataUrlMatch[1] : value, dataUrlMatch ? "base64" : "utf8");
  }

  return Buffer.from(value);
}
