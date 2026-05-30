import { jsonOutput } from "./output.js";
import { AutomifyError } from "./errors.js";

export function createZodOutput(zod) {
  if (!zod || typeof zod.toJSONSchema !== "function") {
    throw new AutomifyError("Zod output support requires Zod 4 with z.toJSONSchema().");
  }

  return function zodOutput(name, schema, options = {}) {
    if (!schema || typeof schema !== "object") {
      throw new AutomifyError("zodOutput requires a Zod schema.");
    }

    if (typeof schema.parse !== "function") {
      throw new AutomifyError("zodOutput schema must expose a parse() function.");
    }

    return {
      ...jsonOutput(name, zod.toJSONSchema(schema, options.zodToJsonSchema)),
      description: options.description,
      strict: options.strict ?? true,
      parse: options.parse,
      parseResult: options.parse === false ? undefined : (value) => schema.parse(value)
    };
  };
}
