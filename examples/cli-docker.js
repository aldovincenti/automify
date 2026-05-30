import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { initAutomify } from "../src/index.js";

const sharedDir = await mkdtemp(join(tmpdir(), "automify-docker-cli-"));
const dataDir = join(sharedDir, "data");
const reportPath = join(dataDir, "report.csv");
const summaryPath = join(dataDir, "summary.json");

await mkdir(dataDir, { recursive: true });
await writeFile(
  reportPath,
  "region,customer,revenue\n" + "North,Ada Corp,1250\n" + "South,Byron Ltd,980\n" + "North,Lovelace Labs,2230\n"
);
await writeFile(summaryPath, "{}\n");

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-5.5"
  }
});

const cli = automify.dockerCli({
  additionalAptPackages: ["coreutils", "nodejs"],
  shared: { hostPath: sharedDir, containerPath: "/workspace" }
});

try {
  const result = await cli.do(
    "Read data/report.csv, use a Node.js script to calculate revenue by region, update data/summary.json with the result, and report the top region"
  );
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  console.log(result.text);
  console.log(summary);
  console.log("Shared output file:", summaryPath);
} finally {
  await cli.close();
}
