import { writeFile } from "node:fs/promises";
import { argumentReference } from "../src/lib/argument-reference.js";

const rows = argumentReference
  .map(
    (entry) => `| \`${entry.surface}\` | ${entry.preferred.map((name) => `\`${name}\``).join(", ")} | ${entry.notes} |`
  )
  .join("\n");

const markdown = `# Automify Argument Reference

This file is generated from \`src/lib/argument-reference.js\`.

| Surface | Preferred arguments | Notes |
| ------- | ------------------- | ----- |
${rows}
`;

await writeFile(new URL("../docs/argument-reference.md", import.meta.url), markdown);
