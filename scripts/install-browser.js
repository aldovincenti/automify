import { spawnSync } from "node:child_process";

if (process.env.AUTOMIFY_SKIP_BROWSER_INSTALL === "1" || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
  process.exit(0);
}

const result = spawnSync(process.execPath, ["node_modules/playwright/cli.js", "install", "chromium"], {
  cwd: process.cwd(),
  stdio: "inherit"
});

process.exit(result.status ?? 1);
