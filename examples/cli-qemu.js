import { initAutomify } from "../src/index.js";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5.5"
  }
});

const cli = automify.virtualCli({
  vm: {
    memory: "2g",
    cpus: 2
  },
  additionalAptPackages: ["coreutils"],
  shared: { hostPath: process.cwd(), containerPath: "/workspace" },
  command: {
    allow: ["cat /etc/os-release", "uname -m", "pwd"]
  }
});

try {
  const result = await cli.do("Run 'cat /etc/os-release', 'uname -m', and 'pwd', then summarize the VM environment.");
  console.log(result.text);
} finally {
  await cli.close();
}
