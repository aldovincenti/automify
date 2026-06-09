import { join } from "node:path";
import { tmpdir } from "node:os";

import { createVirtualDesktopComputer, initAutomify } from "../src/index.js";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5.5"
  }
});

const computer = await createVirtualDesktopComputer({
  vm: {
    memory: "2g",
    cpus: 2
  },
  desktop: {
    startupCommand: "xterm"
  }
});

try {
  const desktop = automify.computer({ computer });
  const result = await desktop.do(
    "Use the open terminal to run 'uname -a' and summarize the VM system information shown on screen.",
    {
      screenshots: {
        initial: join(tmpdir(), "automify-qemu-desktop-initial.png"),
        final: join(tmpdir(), "automify-qemu-desktop-final.png")
      },
      limits: { steps: 12 }
    }
  );

  console.log(result.text);
  console.log(result.finalScreenshot);
} finally {
  await computer.close();
}
