import assert from "node:assert/strict";
import { test } from "node:test";

import { createModelAdapter, initAutomify } from "../src/index.js";

test("createModelAdapter accepts createResponse adapters", async () => {
  const adapter = createModelAdapter({
    async createResponse(payload) {
      return { id: "resp_1", output: [], payload };
    }
  });

  const response = await adapter.createResponse({ model: "custom" });

  assert.equal(response.id, "resp_1");
  assert.equal(response.payload.model, "custom");
});

test("createModelAdapter wraps respond adapters and passes context", async () => {
  const adapter = createModelAdapter({
    async respond(payload, context) {
      return { id: "resp_1", output: [], payload, context };
    }
  });

  const response = await adapter.createResponse({ model: "custom" }, { phase: "initial" });

  assert.equal(response.id, "resp_1");
  assert.equal(response.payload.model, "custom");
  assert.equal(response.context.phase, "initial");
});

test("createModelAdapter accepts adapter factories", async () => {
  const adapter = createModelAdapter({
    options: { provider: "custom" },
    create(options) {
      return {
        async respond(payload) {
          return { id: "resp_1", output: [], provider: options.provider, payload };
        }
      };
    }
  });

  const response = await adapter.createResponse({ model: "custom" });

  assert.equal(response.provider, "custom");
  assert.equal(response.payload.model, "custom");
});

test("createModelAdapter accepts function factories", async () => {
  const adapter = createModelAdapter((options) => ({
    async respond(payload) {
      return { id: "resp_1", output: [], payload, options };
    }
  }), { endpoint: "local" });

  const response = await adapter.createResponse({ model: "custom" });

  assert.equal(response.id, "resp_1");
  assert.equal(response.options.endpoint, "local");
});

test("initAutomify uses a custom provider adapter with requestOptions and context", async () => {
  const seen = [];
  const automify = initAutomify({
    provider: {
      type: "custom",
      model: "adapter-model",
      adapter: {
        async respond(payload, context) {
          seen.push({ payload, context });
          return { id: "resp_1", output: [], payload };
        }
      }
    },
    requestOptions: { temperature: 0.2, metadata: { source: "test" } },
  });
  const cli = automify.cli({
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  const result = await cli.do("Say done");

  assert.equal(result.completed, true);
  assert.equal(result.response.payload.model, "adapter-model");
  assert.equal(result.response.payload.temperature, 0.2);
  assert.equal(seen[0].context.surface, "cli");
  assert.equal(seen[0].context.phase, "initial");
});
