const surfaceExamples = {
  browser: {
    title: "Browser",
    description: "Control a real browser and return structured data.",
    response: `{
  id: "rec_ada_lovelace",
  firstName: "Ada",
  lastName: "Lovelace"
}`,
    code: `import { initAutomify, jsonOutput } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

const browser = await automify.browser({
  startUrl: "https://aldovincenti.github.io/automify/demo.html",
  screenshots: {
    actions: "/tmp/automify-browser-actions"
  }
});

try {
  const run = await browser.do("Add this person and return the saved record.", {
    data: { firstName: "Ada", lastName: "Lovelace" },
    output: jsonOutput("person_record", {
      id: "string",
      firstName: "string",
      lastName: "string"
    })
  });

  console.log(run.parsed);
} finally {
  await browser.close();
}`
  },
  cli: {
    title: "CLI",
    description: "Run approved commands and parse the result.",
    response: `true "All tests passed."`,
    code: `import { initAutomify, jsonOutput } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

const cli = automify.cli({
  command: {
    cwd: process.cwd(),
    allow: ["npm test"]
  },
  debug: true
});

const run = await cli.do("Run tests.", {
  output: jsonOutput("test_result", {
    passed: "boolean",
    summary: "string"
  })
});

console.log(run.parsed.passed, run.parsed.summary);`
  },
  dockerCli: {
    title: "Docker CLI",
    description: "Run an isolated command task against a real shared file.",
    response: `{
  topRegion: "North",
  totalRevenue: 3480,
  outputFile: "data/summary.json",
  summary: "North leads with 3480 revenue."
}
{
  North: 3480,
  South: 980
}
Shared output file: /tmp/automify-docker-cli-438292/data/summary.json`,
    code: `import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { filesToData, initAutomify, jsonOutput } from "automify";

const sharedDir = await mkdtemp(join(tmpdir(), "automify-docker-cli-"));
const dataDir = join(sharedDir, "data");
const reportPath = join(dataDir, "report.csv");
const summaryPath = join(dataDir, "summary.json");

await mkdir(dataDir, { recursive: true });
await writeFile(
  reportPath,
  "region,customer,revenue\\n" +
    "North,Ada Corp,1250\\n" +
    "South,Byron Ltd,980\\n" +
    "North,Lovelace Labs,2230\\n"
);
await writeFile(summaryPath, "{}\\n");

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

const cli = automify.dockerCli({
  additionalAptPackages: ["coreutils", "nodejs"],
  shared: { hostPath: sharedDir, containerPath: "/workspace" }
});

try {
  const run = await cli.do("Read data/report.csv, use a Node.js script to calculate revenue by region, update data/summary.json with the result, and return the top region.", {
    data: {
      files: await filesToData(reportPath, { format: "metadata" })
    },
    output: jsonOutput("report_summary", {
      topRegion: "string",
      totalRevenue: "number",
      outputFile: "string",
      summary: "string"
    })
  });

  const summaryFile = JSON.parse(await readFile(summaryPath, "utf8"));
  console.log(run.parsed, summaryFile);
  console.log("Shared output file:", summaryPath);
} finally {
  await cli.close();
}
`
  },
  desktop: {
    title: "Desktop",
    description: "Use a local desktop through the same computer API.",
    response: `"Design review" "2026-05-29T15:00:00+02:00"`,
    code: `npx automify-install-desktop

// Then in your Node.js code:
import { initAutomify, jsonOutput } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

const desktop = await automify.localComputer();

try {
  const run = await desktop.do("Open the Calendar app installed on this computer, find the next event after today, and return its title and start time. Do not create or edit events.", {
    screenshots: {
      actions: "/tmp/automify-local-actions",
      final: "/tmp/automify-local-final.png"
    },
    output: jsonOutput("next_event", {
      title: "string",
      startsAt: "string"
    })
  });

  console.log(run.parsed.title, run.parsed.startsAt);
} finally {
  await desktop.close();
}`
  },
  dockerDesktop: {
    title: "Docker desktop",
    description: "Launch an isolated Linux desktop and operate a visible app.",
    response: `{
  kernelName: "Linux",
  machine: "x86_64",
  summary: "The terminal reports a Linux x86_64 environment."
}`,
    code: `import { initAutomify, jsonOutput } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

const desktop = await automify.dockerComputer({
  // Required initial app for the Docker desktop.
  desktop: {
    startupCommand: "xterm"
  }
});

try {
  const run = await desktop.do("Use the open terminal to run 'uname -a', then return the kernel name and machine architecture shown on screen.", {
    screenshots: {
      actions: "/tmp/automify-docker-desktop-actions",
      final: "/tmp/automify-docker-desktop-final.png"
    },
    output: jsonOutput("system_info", {
      kernelName: "string",
      machine: "string",
      summary: "string"
    })
  });

  console.log(run.parsed);
} finally {
  await desktop.close();
}`
  }
};

function enhanceCodeBlockCopyButtons() {
  for (const code of document.querySelectorAll("pre > code")) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.copyEnhanced === "true") continue;
    if (pre.closest(".hero-code")) continue;
    if (pre.closest(".example-response")) continue;

    const button = document.createElement("button");
    button.className = "copy-button code-copy-button";
    button.type = "button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code example");

    pre.dataset.copyEnhanced = "true";
    pre.classList.add("code-copy-ready");
    pre.append(button);
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed.");
    }
  } finally {
    textarea.remove();
  }
}

enhanceCodeBlockCopyButtons();

document.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy]");
  const codeCopyButton = event.target.closest(".code-copy-button");
  const button = copyButton ?? codeCopyButton;

  if (button) {
    const code = codeCopyButton?.closest("pre")?.querySelector("code");
    const value = copyButton?.getAttribute("data-copy") ?? code?.textContent ?? "";

    try {
      await copyText(value);
      const previous = button.textContent;
      button.textContent = "Copied";
      button.setAttribute("data-copied", "true");

      window.setTimeout(() => {
        button.textContent = previous;
        button.removeAttribute("data-copied");
      }, 1200);
    } catch {
      button.textContent = "Copy failed";
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1200);
    }

    return;
  }

  const tab = event.target.closest("[data-surface-tab]");
  if (!tab) return;

  const surface = tab.getAttribute("data-surface-tab");
  const example = surfaceExamples[surface];
  if (!example) return;

  for (const button of document.querySelectorAll("[data-surface-tab]")) {
    const active = button === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }

  const code = document.querySelector("#surface-example-code");
  const copy = document.querySelector("#surface-example-copy");
  if (!code || !copy) return;

  code.textContent = example.code;
  copy.innerHTML = `<h3>${example.title}</h3><p>${example.description}</p><div class="example-response"><span>Example response</span><pre><code>${escapeHtml(example.response)}</code></pre></div>`;
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
