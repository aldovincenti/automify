import { AutomifyError } from "./errors.js";

export function createModelAdapter(adapter, config = {}) {
  if (typeof adapter === "function") {
    return createModelAdapter(adapter(config), config);
  }

  if (!adapter || typeof adapter !== "object") {
    throw new AutomifyError("A model adapter object is required.");
  }

  if (typeof adapter.create === "function") {
    return createModelAdapter(adapter.create({ ...config, ...(adapter.options ?? {}) }), {
      ...config,
      ...(adapter.options ?? {})
    });
  }

  if (typeof adapter.createResponse === "function") {
    return adapter;
  }

  if (typeof adapter.respond === "function") {
    return {
      createResponse(payload, context) {
        return adapter.respond(payload, context);
      }
    };
  }

  throw new AutomifyError("A model adapter must provide createResponse(payload) or respond(payload).");
}
