import { initAutomify } from "../src/index.js";

const customModelAdapter = {
  async respond(payload, context) {
    // Translate automify's Responses-shaped payload to your provider here.
    // Then translate your provider's response back into this shape.
    console.log("Model request:", {
      model: payload.model,
      tools: payload.tools?.map((tool) => tool.type ?? tool.name),
      previousResponseId: payload.previous_response_id,
      context
    });

    return {
      id: `custom_${Date.now()}`,
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "This response came from a custom model adapter."
            }
          ]
        }
      ]
    };
  }
};

const automify = initAutomify({
  provider: {
    type: "custom",
    model: "my-computer-use-model",
    adapter: customModelAdapter
  },
  requestOptions: {
    temperature: 0.2,
    metadata: { example: "custom-model-adapter" }
  }
});

const cli = automify.cli({
  cwd: process.cwd()
});

const result = await cli.do("Explain what model adapter is being used");
console.log(result.response);
