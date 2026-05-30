import { initAutomify } from "../src/index.js";

const automify = initAutomify({
  provider: {
    type: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    betas: ["computer-use-2025-01-24"]
  }
});

const cli = automify.cli({
  cwd: process.cwd()
});

const result = await cli.do("Inspect this project and tell me how to run the tests");
console.log(result.response);
