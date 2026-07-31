import { initAutomify, jsonOutput } from "../src/index.js";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.6-sol"
  }
});

const browser = await automify.browser({
  startUrl: "https://aldovincenti.github.io/automify/demo.html"
});

try {
  const result = await browser.do("Add the person from data, then read the Latest saved record JSON block.", {
    data: {
      firstName: "Grace",
      lastName: "Hopper"
    },
    output: jsonOutput("person_record", {
      id: "string",
      firstName: "string",
      lastName: "string"
    })
  });
  console.log(result.parsed);
} catch (error) {
  console.error("Automation failed:", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
