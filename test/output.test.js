import assert from "node:assert/strict";
import { test } from "node:test";

import { AutomifyError, jsonOutput } from "../src/index.js";
import { message, response } from "../src/lib/adapter-toolkit.js";
import { buildRunResult } from "../src/lib/result.js";
import { createZodOutput } from "../src/lib/zod-output.js";

test("jsonOutput builds a strict schema from a compact shape", () => {
  assert.deepEqual(jsonOutput("created_lead", { recordId: "string", score: "number" }), {
    type: "json_schema",
    name: "created_lead",
    schema: {
      type: "object",
      properties: {
        recordId: { type: "string" },
        score: { type: "number" }
      },
      required: ["recordId", "score"],
      additionalProperties: false
    },
    strict: true,
    description: undefined,
    parse: undefined
  });
});

test("jsonOutput accepts full JSON schema when needed", () => {
  const schema = {
    type: "object",
    properties: {
      email: { type: "string", format: "email" }
    },
    required: ["email"],
    additionalProperties: false
  };

  assert.deepEqual(jsonOutput("support_contact", schema, { strict: false }), {
    type: "json_schema",
    name: "support_contact",
    schema,
    strict: false,
    description: undefined,
    parse: undefined
  });
});

test("jsonOutput rejects ambiguous shapes", () => {
  assert.throws(() => jsonOutput("", { id: "string" }), AutomifyError);
  assert.throws(() => jsonOutput("bad", { id: "uuid" }), AutomifyError);
  assert.throws(() => jsonOutput("bad", null), AutomifyError);
});

test("zodOutput converts Zod schemas through the provided converter", () => {
  const schema = {
    parse(value) {
      return { ...value, parsed: true };
    }
  };
  const zodOutput = createZodOutput({
    toJSONSchema(value) {
      assert.equal(value, schema);
      return {
        type: "object",
        properties: {
          email: { type: "string", format: "email" }
        },
        required: ["email"],
        additionalProperties: false
      };
    }
  });

  const output = zodOutput("support_contact", schema, { description: "Support contact" });

  assert.deepEqual(
    { ...output, parseResult: undefined },
    {
      type: "json_schema",
      name: "support_contact",
      schema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" }
        },
        required: ["email"],
        additionalProperties: false
      },
      strict: true,
      description: "Support contact",
      parse: undefined,
      parseResult: undefined
    }
  );
  assert.deepEqual(output.parseResult({ email: "support@example.com" }), {
    email: "support@example.com",
    parsed: true
  });
});

test("zodOutput can skip result parsing", () => {
  const zodOutput = createZodOutput({
    toJSONSchema() {
      return {
        type: "object",
        properties: {
          email: { type: "string" }
        },
        required: ["email"],
        additionalProperties: false
      };
    }
  });

  const output = zodOutput("support_contact", { parse() {} }, { parse: false });

  assert.equal(output.parse, false);
  assert.equal(output.parseResult, undefined);
});

test("zodOutput rejects unsupported Zod versions", () => {
  assert.throws(() => createZodOutput({}), AutomifyError);
});

test("buildRunResult validates parsed structured output when a parser is provided", () => {
  const output = {
    type: "json_schema",
    name: "support_contact",
    schema: {
      type: "object",
      properties: {
        email: { type: "string" }
      },
      required: ["email"],
      additionalProperties: false
    },
    parseResult(value) {
      return { ...value, normalized: value.email.toLowerCase() };
    }
  };

  const result = buildRunResult(response({ output: [message('{"email":"SUPPORT@EXAMPLE.COM"}')] }), [], output);

  assert.deepEqual(result.parsed, {
    email: "SUPPORT@EXAMPLE.COM",
    normalized: "support@example.com"
  });
});
