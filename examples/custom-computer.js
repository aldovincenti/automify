import { createLocalDesktopComputer, initAutomify } from "../src/index.js";

// Run `npx automify-install-desktop` once before using createLocalDesktopComputer().
const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

const desktop = automify.computer({
  computer: await createLocalDesktopComputer()
});

await desktop.do("Open the calendar app and check my next meeting", {
  limits: { steps: 12 }
});
