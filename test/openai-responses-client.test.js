import assert from "node:assert/strict";
import { test } from "node:test";

import { OpenAIResponsesClient } from "../src/index.js";

test("OpenAIResponsesClient posts to the Responses API with bearer auth", async () => {
  const requests = [];
  const client = new OpenAIResponsesClient({
    openaiApiKey: "token_123",
    baseURL: "https://api.test/v1/",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ id: "resp_123", output: [] }), { status: 200 });
    }
  });

  const response = await client.createResponse({ model: "gpt-5.5", input: [] });

  assert.deepEqual(response, { id: "resp_123", output: [] });
  assert.equal(requests[0].url, "https://api.test/v1/responses");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.authorization, "Bearer token_123");
  assert.equal(requests[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].init.body), { model: "gpt-5.5", input: [] });
});

test("OpenAIResponsesClient maps generic computer tools to the GA OpenAI Responses wire format", async () => {
  const requests = [];
  const client = new OpenAIResponsesClient({
    openaiApiKey: "token_123",
    baseURL: "https://api.test/v1/",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ id: "resp_123", output: [] }), { status: 200 });
    }
  });

  await client.createResponse({
    model: "gpt-5.5",
    tools: [
      {
        type: "computer",
        environment: "browser",
        displayWidth: 1024,
        displayHeight: 768
      }
    ],
    input: []
  });

  assert.deepEqual(JSON.parse(requests[0].init.body).tools, [
    {
      type: "computer"
    }
  ]);
});

test("OpenAIResponsesClient keeps the legacy preview computer wire format for the preview model", async () => {
  const requests = [];
  const client = new OpenAIResponsesClient({
    openaiApiKey: "token_123",
    baseURL: "https://api.test/v1/",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ id: "resp_123", output: [] }), { status: 200 });
    }
  });

  await client.createResponse({
    model: "computer-use-preview",
    tools: [
      {
        type: "computer",
        environment: "browser",
        displayWidth: 1024,
        displayHeight: 768
      }
    ],
    input: []
  });

  assert.deepEqual(JSON.parse(requests[0].init.body).tools, [
    {
      type: "computer_use_preview",
      environment: "browser",
      display_width: 1024,
      display_height: 768
    }
  ]);
});

test("OpenAIResponsesClient surfaces API errors", async () => {
  const client = new OpenAIResponsesClient({
    openaiApiKey: "token_123",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "bad request" } }), {
        status: 400,
        statusText: "Bad Request"
      })
  });

  await assert.rejects(() => client.createResponse({}), /bad request/);
});

test("OpenAIResponsesClient retries retryable API errors", async () => {
  let attempts = 0;
  const client = new OpenAIResponsesClient({
    openaiApiKey: "token_123",
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
      }
      return new Response(JSON.stringify({ id: "resp_retry", output: [] }), { status: 200 });
    }
  });

  const response = await client.createResponse({ model: "gpt-5.5", input: [] });

  assert.equal(attempts, 2);
  assert.equal(response.id, "resp_retry");
});

test("OpenAIResponsesClient includes request ids in API errors", async () => {
  const client = new OpenAIResponsesClient({
    openaiApiKey: "token_123",
    maxRetries: 0,
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "bad request" } }), {
        status: 400,
        headers: { "x-request-id": "req_123" }
      })
  });

  await assert.rejects(() => client.createResponse({}), /req_123/);
});
