import { AutomifyError } from "./errors.js";

const PRIMITIVE_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

export function jsonOutput(name, shape, options = {}) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new AutomifyError("jsonOutput requires a non-empty name.");
  }

  return {
    type: "json_schema",
    name,
    schema: normalizeSchema(shape),
    strict: options.strict ?? true,
    description: options.description,
    parse: options.parse
  };
}

function normalizeSchema(shape) {
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) {
    throw new AutomifyError("jsonOutput requires an object shape or JSON schema.");
  }

  if (shape.type === "object" && shape.properties) {
    return shape;
  }

  const properties = {};

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = normalizeProperty(value, key);
  }

  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false
  };
}

function normalizeProperty(value, key) {
  if (typeof value === "string") {
    if (!PRIMITIVE_TYPES.has(value)) {
      throw new AutomifyError(`Unsupported jsonOutput type for "${key}": ${value}`);
    }

    return { type: value };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  throw new AutomifyError(`jsonOutput field "${key}" must be a JSON type string or schema object.`);
}
