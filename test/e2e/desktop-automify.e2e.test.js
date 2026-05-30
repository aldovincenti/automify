import assert from "node:assert/strict";
import { test } from "node:test";

import { createComputerAutomify } from "../../src/index.js";

test("e2e: desktop automify drives a custom computer adapter", async () => {
  const calls = [];
  const desktopState = {
    focused: false,
    text: "",
    screenshots: 0
  };
  const computer = {
    environment: "mac",
    async execute(action) {
      if (action.type === "click") {
        desktopState.focused = true;
      }
      if (action.type === "type" && desktopState.focused) {
        desktopState.text += action.text;
      }
      if (action.type === "keypress" && action.keys?.includes("Enter")) {
        desktopState.text += "\n";
      }
    },
    async screenshot() {
      desktopState.screenshots += 1;
      return Buffer.from(`desktop:${desktopState.text}`);
    }
  };
  const automify = createComputerAutomify({
    client: {
      async createResponse(payload) {
        calls.push(payload);

        if (calls.length === 1) {
          return {
            id: "resp_1",
            output: [
              {
                type: "computer_call",
                call_id: "call_1",
                actions: [
                  { type: "click", x: 40, y: 50, button: "left" },
                  { type: "type", text: "release checklist" },
                  { type: "keypress", keys: ["Enter"] }
                ],
                pending_safety_checks: []
              }
            ]
          };
        }

        return {
          id: "resp_done",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    text: desktopState.text,
                    focused: desktopState.focused
                  })
                }
              ]
            }
          ]
        };
      }
    },
    computer,
    model: "test-desktop-model"
  });

  const result = await automify.do("Focus the editor and type the release checklist.", {
    output: {
      type: "json_schema",
      name: "desktop_result",
      schema: {
        type: "object",
        properties: {
          text: { type: "string" },
          focused: { type: "boolean" }
        },
        required: ["text", "focused"],
        additionalProperties: false
      }
    }
  });

  assert.equal(result.completed, true);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].actions.length, 3);
  assert.equal(desktopState.text, "release checklist\n");
  assert.equal(desktopState.screenshots, 1);
  assert.deepEqual(result.parsed, {
    text: "release checklist\n",
    focused: true
  });
  assert.deepEqual(calls[0].tools, [{ type: "computer", environment: expectedDefaultComputerEnvironment() }]);
  assert.match(calls[1].input[0].output.image_url, /^data:image\/png;base64,/);
});

function expectedDefaultComputerEnvironment() {
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    default:
      return "ubuntu";
  }
}
