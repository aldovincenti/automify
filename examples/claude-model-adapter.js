import {
  computerCall,
  getComputerTool,
  getInputText,
  getLastComputerScreenshot,
  initAutomify,
  message,
  response,
  runCommandCall
} from "../src/index.js";

function createClaudeModelAdapter({ anthropicApiKey, fetchImpl = fetch } = {}) {
  return {
    async respond(payload, context) {
      const claudeRequest = toClaudeRequest(payload, context);

      // Uncomment this block when wiring a real Anthropic account.
      //
      // const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      //   method: "POST",
      //   headers: {
      //     "x-api-key": anthropicApiKey,
      //     "anthropic-version": "2023-06-01",
      //     "content-type": "application/json"
      //   },
      //   body: JSON.stringify(claudeRequest)
      // });
      // const claude = await res.json();
      // return fromClaudeResponse(claude, context);

      console.log("Claude request shape:", claudeRequest);
      return response({ output: [message("Claude adapter is wired. Connect fetch to call Anthropic.")] });
    }
  };
}

function toClaudeRequest(payload, context) {
  const screenshot = getLastComputerScreenshot(payload);

  return {
    model: payload.model,
    max_tokens: payload.max_tokens ?? 4096,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: getInputText(payload) || "Continue." },
          ...(screenshot
            ? [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: screenshot.mediaType,
                    data: screenshot.base64
                  }
                }
              ]
            : [])
        ]
      }
    ],
    tools: toClaudeTools(payload, context)
  };
}

function toClaudeTools(payload, context) {
  if (context.surface === "cli") {
    return [
      {
        name: "run_command",
        description: "Run a shell command.",
        input_schema: {
          type: "object",
          properties: {
            command: { type: "string" }
          },
          required: ["command"]
        }
      }
    ];
  }

  if (getComputerTool(payload)) {
    return [
      {
        name: "computer",
        description: "Control the visible computer with mouse and keyboard actions.",
        input_schema: {
          type: "object",
          properties: {
            action: { type: "object" }
          },
          required: ["action"]
        }
      }
    ];
  }

  return [];
}

function fromClaudeResponse(claude, context) {
  const toolUse = claude.content?.find((item) => item.type === "tool_use");
  const text = claude.content?.find((item) => item.type === "text")?.text;

  if (!toolUse) {
    return response({ id: claude.id, output: [message(text ?? "")] });
  }

  if (toolUse.name === "run_command") {
    return response({
      id: claude.id,
      output: [runCommandCall(toolUse.input.command, { callId: toolUse.id })]
    });
  }

  if (toolUse.name === "computer") {
    return response({
      id: claude.id,
      output: [computerCall(toolUse.input.action, { callId: toolUse.id })]
    });
  }

  return response({ id: claude.id, output: [message(`Unsupported tool: ${toolUse.name}`)] });
}

const automify = initAutomify({
  provider: {
    type: "custom",
    model: "claude-computer-use-model",
    options: {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY
    },
    adapter: (options) => createClaudeModelAdapter(options)
  }
});

const cli = automify.cli({ cwd: process.cwd() });
const result = await cli.do("Explain how this Claude adapter maps tool calls.");
console.log(result.response);
