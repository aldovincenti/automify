import { getOutputText, parseOutputJson } from "./adapter-toolkit.js";
import { AutomifyError } from "./errors.js";

export function buildRunResult(response, steps, output) {
  const text = getOutputText(response);
  const result = {
    response,
    steps,
    ok: true,
    status: "succeeded",
    completed: true,
    stopReason: "done",
    text
  };

  if (shouldParseStructuredOutput(output, text)) {
    const parsed = parseOutputJson(response);
    result.parsed = typeof output.parseResult === "function" ? output.parseResult(parsed) : parsed;
  }

  return result;
}

export function buildTextConfig(output) {
  if (!output) return undefined;

  if (output.type === "text") {
    return { format: { type: "text" } };
  }

  if (output.type === "json_object") {
    return { format: { type: "json_object" } };
  }

  if (output.type === "json_schema") {
    if (typeof output.name !== "string" || output.name.trim() === "") {
      throw new AutomifyError("Structured output requires a non-empty output.name.");
    }

    if (!output.schema || typeof output.schema !== "object") {
      throw new AutomifyError("Structured output requires an output.schema object.");
    }

    return {
      format: removeUndefined({
        type: "json_schema",
        name: output.name,
        description: output.description,
        schema: output.schema,
        strict: output.strict
      })
    };
  }

  throw new AutomifyError(`Unsupported output.type: ${output.type}`);
}

export function buildOutputInstruction(textConfig) {
  const format = textConfig?.format;
  if (!format || format.type === "text") return "";

  if (format.type === "json_object") {
    return [
      "Return only a valid JSON object.",
      "Do not wrap it in Markdown.",
      "Do not include prose before or after the JSON."
    ].join(" ");
  }

  if (format.type === "json_schema") {
    return [
      "Return only valid JSON matching this schema.",
      "Do not wrap it in Markdown.",
      "Do not include prose before or after the JSON.",
      JSON.stringify({
        name: format.name,
        description: format.description,
        schema: format.schema,
        strict: format.strict
      })
    ].join(" ");
  }

  return "";
}

function shouldParseStructuredOutput(output, text) {
  return Boolean(
    text && output && (output.type === "json_schema" || output.type === "json_object") && output.parse !== false
  );
}

function removeUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
