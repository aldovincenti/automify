import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDockerDesktopComputer, filesToData, initAutomify } from "../src/index.js";

const inputPath = join(tmpdir(), "automify-input.txt");
await writeFile(inputPath, "Customer: Ada Lovelace\nTask: prepare a short follow-up note\n");

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5.6-sol"
  }
});

const fileData = await filesToData(inputPath);
const computer = await createDockerDesktopComputer({
  desktop: {
    startupCommand: "xterm"
  },
  sharedFiles: [{ path: inputPath, targetPath: "inputs/customer.txt" }]
});

try {
  const desktop = automify.computer({ computer });
  const result = await desktop.do("Open the shared file from data and summarize it in the terminal.", {
    data: {
      files: fileData,
      shared: computer.sharedFolder
    },
    screenshots: {
      final: join(tmpdir(), "automify-shared-folder-final.png")
    }
  });

  console.log(result.text);
  console.log(computer.sharedFolder);
} finally {
  await computer.close();
}
