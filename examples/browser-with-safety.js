import { initAutomify } from "../src/index.js";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  },
  debug: true
});

await automify.withBrowser(
  {
    startUrl: "https://example.com",
    safety: {
      domains: ["example.com"]
    },
    hooks: {
      step: ({ phase, action }) => {
        console.log("Step:", phase, action);
      }
    }
  },
  async (browser) => {
    return browser.do("Find the contact page and report the support address", {
      safety: {
        onCheck: async ({ checks, action }) => {
          console.log("Safety checks:", checks);
          console.log("Action:", action);
          return true;
        }
      }
    });
  }
);
