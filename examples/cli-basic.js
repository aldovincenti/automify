import { initAutomify } from "../src/index.js";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.6-sol"
  }
});

const cli = automify.cli({
  command: {
    cwd: process.cwd(),
    allow: ["npm", "node", "ls", "pwd"],
    block: [/^rm\b/, /^git push\b/]
  }
});

const result = await cli.do("Inspect this project and tell me how to run its tests");
console.log(result.response);
