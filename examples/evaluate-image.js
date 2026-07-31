import { initAutomify, jsonOutput } from "../src/index.js";

const imagePath = process.argv[2];

if (!imagePath) {
  throw new Error("Usage: node examples/evaluate-image.js /path/to/image.png");
}

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5.6-sol"
  }
});

const cli = automify.cli();
const result = await cli.do("Evaluate the supplied image and return a concise visual QA report.", {
  evaluate: [{ path: imagePath, detail: "high" }],
  output: jsonOutput("image_evaluation", {
    summary: "string",
    issues: "array"
  })
});

console.log(result.parsed ?? result.text);
