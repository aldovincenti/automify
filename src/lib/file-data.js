import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { AutomifyError } from "./errors.js";

export async function fileToData(file, options = {}) {
  const descriptor = normalizeFileDescriptor(file);
  const path = resolve(descriptor.path);
  const info = await stat(path);
  if (!info.isFile()) {
    throw new AutomifyError(`fileToData expected a file: ${path}`);
  }

  const mediaType = descriptor.mediaType ?? options.mediaType ?? mediaTypeForPath(path);
  const format = descriptor.format ?? options.format ?? "text";
  const entry = {
    name: descriptor.name ?? basename(path),
    path,
    mediaType,
    size: info.size
  };

  if (format === "metadata") return entry;

  const buffer = await readFile(path);
  if (format === "base64") {
    return { ...entry, base64: buffer.toString("base64") };
  }
  if (format === "data_url" || format === "dataUrl") {
    return { ...entry, dataUrl: `data:${mediaType};base64,${buffer.toString("base64")}` };
  }
  if (format === "buffer") {
    return { ...entry, buffer };
  }

  return { ...entry, text: buffer.toString(descriptor.encoding ?? options.encoding ?? "utf8") };
}

export async function filesToData(files, options = {}) {
  const list = Array.isArray(files) ? files : [files];
  return Promise.all(list.map((file) => fileToData(file, options)));
}

export async function fileToEvaluate(file, options = {}) {
  const descriptor = normalizeFileDescriptor(file);
  const path = resolve(descriptor.path);
  const info = await stat(path);
  if (!info.isFile()) {
    throw new AutomifyError(`fileToEvaluate expected a file: ${path}`);
  }

  const name = descriptor.name ?? basename(path);
  const mediaType = descriptor.mediaType ?? options.mediaType ?? mediaTypeForPath(path);
  const detail = descriptor.detail ?? options.detail;

  if (mediaType.startsWith("image/")) {
    const buffer = await readFile(path);
    return {
      type: "input_image",
      image_url: `data:${mediaType};base64,${buffer.toString("base64")}`,
      ...(detail ? { detail } : {})
    };
  }

  if (isTextMediaType(mediaType)) {
    const maxBytes = positiveInteger(descriptor.maxBytes ?? options.maxBytes) ?? 200_000;
    const buffer = await readFile(path);
    const truncated = buffer.byteLength > maxBytes;
    const text = buffer.subarray(0, maxBytes).toString(descriptor.encoding ?? options.encoding ?? "utf8");
    return {
      type: "input_text",
      text: [
        `File for evaluation: ${name}`,
        `Path: ${path}`,
        `Media type: ${mediaType}`,
        truncated ? `Content truncated to ${maxBytes} bytes from ${buffer.byteLength} bytes.` : null,
        "",
        text
      ]
        .filter((part) => part != null)
        .join("\n")
    };
  }

  return {
    type: "input_text",
    text: [
      `File for evaluation: ${name}`,
      `Path: ${path}`,
      `Media type: ${mediaType}`,
      `Size: ${info.size} bytes`,
      "This file type is represented as metadata only."
    ].join("\n")
  };
}

export async function filesToEvaluate(files, options = {}) {
  const list = Array.isArray(files) ? files : [files];
  return Promise.all(list.map((file) => fileToEvaluate(file, options)));
}

function normalizeFileDescriptor(file) {
  if (typeof file === "string") return { path: file };
  if (file && typeof file === "object" && typeof file.path === "string") return file;
  throw new AutomifyError("fileToData files must be paths or objects with a path.");
}

function mediaTypeForPath(path) {
  const ext = extname(path).toLowerCase();
  const types = {
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml"
  };
  return types[ext] ?? "application/octet-stream";
}

function isTextMediaType(mediaType) {
  return (
    mediaType.startsWith("text/") || ["application/json", "application/xml", "application/yaml"].includes(mediaType)
  );
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}
