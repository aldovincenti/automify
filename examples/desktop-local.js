import { join } from "node:path";
import { tmpdir } from "node:os";

import { createLocalDesktopComputer, initAutomify } from "../src/index.js";

// Run `npx automify-install-desktop` once before using createLocalDesktopComputer().
const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5.5"
  }
});

const desktop = automify.computer({
  computer: await createLocalDesktopComputer()
});

const instruction =
  "Open the Calendar app installed on this computer, find the next event after today, and summarize it. Do not create or edit events.";

await desktop.do(instruction, {
  screenshots: {
    initial: join(tmpdir(), "automify-local-desktop-initial.png"),
    final: join(tmpdir(), "automify-local-desktop-final.png")
  },
  limits: { steps: 12 }
});
