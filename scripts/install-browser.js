import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

if (process.env.AUTOMIFY_SKIP_BROWSER_INSTALL === "1" || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
  process.exit(0);
}

const playwrightCli = join(dirname(require.resolve("playwright")), "cli.js");
console.log("Automify: installing Playwright browser...");
const result = spawnSync(process.execPath, [playwrightCli, "install", "chromium"], {
  cwd: process.cwd(),
  stdio: "inherit"
});

process.exit(result.status ?? 1);
