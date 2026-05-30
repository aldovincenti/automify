import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnthropicModelAdapter, initAutomify } from "../src/index.js";

test("Anthropic adapter converts CLI tool use to run_command calls", async () => {
  const requests = [];
  const adapter = createAnthropicModelAdapter({
    anthropicApiKey: "anthropic_key",
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(
        JSON.stringify({
          id: "msg_1",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "run_command",
              input: { command: "npm test" }
            }
          ]
        }),
        { status: 200 }
      );
    }
  });

  const result = await adapter.createResponse(
    {
      model: "claude-test",
      input: [{ role: "user", content: [{ type: "input_text", text: "Run tests" }] }],
      tools: [{ type: "function", name: "run_command", description: "Run command", parameters: { type: "object" } }]
    },
    { surface: "cli", phase: "initial" }
  );

  assert.equal(requests[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(requests[0].init.headers["x-api-key"], "anthropic_key");
  assert.equal(requests[0].body.model, "claude-test");
  assert.equal(requests[0].body.messages[0].content[0].text, "Run tests");
  assert.equal(requests[0].body.tools[0].name, "run_command");
  assert.deepEqual(result.output[0], {
    type: "function_call",
    name: "run_command",
    call_id: "toolu_1",
    arguments: JSON.stringify({ command: "npm test" })
  });
});

test("Anthropic adapter converts computer tool use to computer calls", async () => {
  const adapter = createAnthropicModelAdapter({
    anthropicApiKey: "anthropic_key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: "msg_1",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "computer",
              input: { action: "left_click", coordinate: [10, 20] }
            }
          ]
        }),
        { status: 200 }
      )
  });

  const result = await adapter.createResponse(
    {
      model: "claude-test",
      input: [{ role: "user", content: [{ type: "input_text", text: "Click" }] }],
      tools: [{ type: "computer" }]
    },
    { surface: "computer", phase: "initial" }
  );

  assert.equal(result.output[0].type, "computer_call");
  assert.deepEqual(result.output[0].action, { type: "click", x: 10, y: 20, button: "left" });
});

test("Anthropic adapter declares the sent screenshot dimensions for computer use", async () => {
  const requests = [];
  const adapter = createAnthropicModelAdapter({
    anthropicApiKey: "anthropic_key",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          content: [{ type: "text", text: "Done" }]
        }),
        { status: 200 }
      );
    }
  });

  await adapter.createResponse(
    {
      model: "claude-test",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Look" },
            {
              type: "input_image",
              image_url: `data:image/png;base64,${pngHeader(1440, 936).toString("base64")}`
            }
          ]
        }
      ],
      tools: [{ type: "computer", displayWidth: 2940, displayHeight: 1912 }]
    },
    { surface: "computer", phase: "initial" }
  );

  assert.equal(requests[0].tools[0].display_width_px, 1440);
  assert.equal(requests[0].tools[0].display_height_px, 936);
});

test("Anthropic adapter compacts computer screenshots between turns", async () => {
  const requests = [];
  const adapter = createAnthropicModelAdapter({
    anthropicApiKey: "anthropic_key",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      const index = requests.length;
      return new Response(
        JSON.stringify({
          id: `msg_${index}`,
          content: [
            {
              type: "tool_use",
              id: `toolu_${index}`,
              name: "computer",
              input: { action: index === 1 ? "screenshot" : "left_click", coordinate: [10, 20] }
            }
          ]
        }),
        { status: 200 }
      );
    }
  });

  await adapter.createResponse(
    {
      model: "claude-test",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Open Calendar" },
            { type: "input_image", image_url: `data:image/png;base64,${pngHeader(1280, 800).toString("base64")}` }
          ]
        }
      ],
      tools: [{ type: "computer" }]
    },
    { surface: "computer", phase: "initial" }
  );

  await adapter.createResponse(
    {
      model: "claude-test",
      previous_response_id: "msg_1",
      input: [
        {
          type: "computer_call_output",
          call_id: "toolu_1",
          output: {
            type: "computer_screenshot",
            image_url: `data:image/png;base64,${pngHeader(1280, 800).toString("base64")}`
          }
        }
      ],
      tools: [{ type: "computer" }]
    },
    { surface: "computer", phase: "continue" }
  );

  await adapter.createResponse(
    {
      model: "claude-test",
      previous_response_id: "msg_2",
      input: [
        {
          type: "computer_call_output",
          call_id: "toolu_2",
          output: {
            type: "computer_screenshot",
            image_url: `data:image/png;base64,${pngHeader(1280, 800).toString("base64")}`
          }
        }
      ],
      tools: [{ type: "computer" }]
    },
    { surface: "computer", phase: "continue" }
  );

  assert.equal(requests[2].messages.length, 3);
  assert.equal(requests[2].messages[0].role, "user");
  assert.equal(requests[2].messages[0].content.length, 1);
  assert.equal(requests[2].messages[0].content[0].text, "Open Calendar");
  assert.equal(requests[2].messages[1].role, "assistant");
  assert.equal(requests[2].messages[2].role, "user");
  assert.equal(requests[2].messages[2].content[0].type, "tool_result");
});

test("Anthropic adapter turns structured output config into JSON instructions", async () => {
  const requests = [];
  const adapter = createAnthropicModelAdapter({
    anthropicApiKey: "anthropic_key",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          content: [{ type: "text", text: '{"recordId":"rec_123"}' }]
        }),
        { status: 200 }
      );
    }
  });

  const result = await adapter.createResponse(
    {
      model: "claude-test",
      input: [{ role: "user", content: [{ type: "input_text", text: "Create the lead and return { recordId }" }] }],
      text: {
        format: {
          type: "json_schema",
          name: "created_lead",
          schema: {
            type: "object",
            properties: {
              recordId: { type: "string" }
            },
            required: ["recordId"],
            additionalProperties: false
          },
          strict: true
        }
      }
    },
    { surface: "cli", phase: "initial" }
  );

  const text = requests[0].messages[0].content[0].text;
  assert.match(text, /Create the lead/);
  assert.match(text, /Return only valid JSON matching this schema/);
  assert.match(text, /created_lead/);
  assert.match(text, /recordId/);
  assert.equal(result.output[0].content[0].text, '{"recordId":"rec_123"}');
});

test("Anthropic adapter repeats structured output instructions after tool results", async () => {
  const requests = [];
  const adapter = createAnthropicModelAdapter({
    anthropicApiKey: "anthropic_key",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          id: "msg_2",
          content: [{ type: "text", text: '{"recordId":"rec_123"}' }]
        }),
        { status: 200 }
      );
    }
  });

  await adapter.createResponse(
    {
      model: "claude-test",
      previous_response_id: "msg_1",
      input: [{ type: "function_call_output", call_id: "toolu_1", output: JSON.stringify({ ok: true }) }],
      text: {
        format: {
          type: "json_schema",
          name: "created_lead",
          schema: {
            type: "object",
            properties: {
              recordId: { type: "string" }
            },
            required: ["recordId"],
            additionalProperties: false
          },
          strict: true
        }
      }
    },
    { surface: "cli", phase: "continue" }
  );

  assert.deepEqual(requests[0].messages[0].content[0], {
    type: "tool_result",
    tool_use_id: "toolu_1",
    content: JSON.stringify({ ok: true })
  });
  assert.equal(requests[0].messages[0].content[1].type, "text");
  assert.match(requests[0].messages[0].content[1].text, /Return only valid JSON matching this schema/);
});

test("Anthropic adapter normalizes prose-wrapped structured JSON responses", async () => {
  const adapter = createAnthropicModelAdapter({
    anthropicApiKey: "anthropic_key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: "msg_1",
          content: [
            {
              type: "text",
              text: 'Perfect! The saved record is:\n\n```json\n{"id":"1","firstName":"Ada","lastName":"Lovelace"}\n```'
            }
          ]
        }),
        { status: 200 }
      )
  });

  const result = await adapter.createResponse(
    {
      model: "claude-test",
      input: [{ role: "user", content: [{ type: "input_text", text: "Add this person" }] }],
      text: {
        format: {
          type: "json_schema",
          name: "person_record",
          schema: {
            type: "object",
            properties: {
              id: { type: "string" },
              firstName: { type: "string" },
              lastName: { type: "string" }
            },
            required: ["id", "firstName", "lastName"],
            additionalProperties: false
          },
          strict: true
        }
      }
    },
    { surface: "browser", phase: "initial" }
  );

  assert.equal(result.output[0].content[0].text, '{"id":"1","firstName":"Ada","lastName":"Lovelace"}');
});

test("initAutomify can select Anthropic provider", async () => {
  const requests = [];
  const automify = initAutomify({
    provider: {
      type: "anthropic",
      apiKey: "anthropic_key",
      model: "claude-test",
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({
            id: "msg_1",
            content: [{ type: "text", text: "Done" }]
          }),
          { status: 200 }
        );
      }
    }
  });
  const cli = automify.cli({
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  const result = await cli.do("Say done");

  assert.equal(result.response.id, "msg_1");
  assert.equal(result.response.output[0].content[0].text, "Done");
  assert.equal(requests[0].model, "claude-test");
});

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}
