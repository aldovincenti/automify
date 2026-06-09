const surfaceExamples = {
  browser: {
    title: "Browser",
    description: "Control a real browser and return structured data.",
    response: `{
  id: "35602f61-8430-4426-81fc-2a31fd69d8b7",
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
} catch (error) {
  console.error("Automation failed:", error);
  process.exitCode = 1;
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
    description: "Run an isolated command task against a real shared file. Requires Docker to be running.",
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
  virtualCli: {
    title: "Virtual CLI",
    description:
      "Run command tasks inside a real QEMU VM. Requires QEMU; without an image override, Automify prepares a default Debian cloud image with SSH access.",
    response: `{
  nodeVersion: "v24.4.1",
  cwd: "/workspace",
  summary: "The QEMU VM ran Node from the shared workspace."
}`,
    code: `import { initAutomify, jsonOutput } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

const cli = automify.virtualCli({
  vm: { memory: "2g", cpus: 2 },
  additionalAptPackages: ["coreutils"],
  shared: { hostPath: process.cwd(), containerPath: "/workspace" }
});

try {
  const run = await cli.do("Run 'node --version' and 'pwd', then summarize the VM environment.", {
    output: jsonOutput("vm_command_result", {
      nodeVersion: "string",
      cwd: "string",
      summary: "string"
    })
  });

  console.log(run.parsed);
} finally {
  await cli.close();
}`
  },
  desktop: {
    title: "Desktop",
    description: "Use a local desktop through the same computer API. Linux requires X11/Xorg or Xvfb; Wayland is not supported.",
    response: `"Design review" "2026-05-29T15:00:00+02:00"`,
    code: `import { initAutomify, jsonOutput } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

// Reminder: local desktop support requires \`npx automify-install-desktop\` once for this project.
const desktop = await automify.localComputer();

try {
  const run = await desktop.do("Open the Calendar app installed on this computer, find the next event, and return its title and start time. Do not create or edit events.", {
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
    description: "Launch an isolated Linux desktop and operate a visible app. Requires Docker to be running.",
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
  },
  virtualDesktop: {
    title: "Virtual desktop",
    description:
      "Control an Xvfb Linux desktop inside a real QEMU VM. Requires QEMU; without an image override, Automify prepares a default Debian cloud image with SSH access.",
    response: `{
  kernelName: "Linux",
  machine: "aarch64",
  summary: "The desktop terminal reports a Linux VM environment."
}`,
    code: `import { initAutomify, jsonOutput } from "automify";

const automify = initAutomify({
  provider: {
    type: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-5.5"
  }
});

const desktop = await automify.virtualComputer({
  vm: { memory: "2g", cpus: 2 },
  desktop: {
    startupCommand: "xterm"
  }
});

try {
  const run = await desktop.do("Use the open terminal to run 'uname -a', then return the kernel name and machine architecture shown on screen.", {
    screenshots: {
      actions: "/tmp/automify-qemu-desktop-actions",
      final: "/tmp/automify-qemu-desktop-final.png"
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

const installCommands = {
  linux: {
    title: "Linux desktop prerequisites",
    label: "OS packages",
    note: "Steps 2 and 3 are only for optional local desktop support. On Linux, install the full package list first; the desktop installer does not verify every native library. Linux local desktop requires X11/Xorg or Xvfb; Wayland is not supported. On Ubuntu, switch to an Xorg session before using local desktop if the current session is Wayland. Ubuntu 26.04 may also need the Playwright platform override shown in Step 1 until native support lands. Step 4 is only for Docker CLI and Docker desktop support. Step 5 is only for QEMU virtual CLI and virtual desktop support.",
    commands: `# Only for optional local desktop support
sudo apt-get update
sudo apt-get install -y git build-essential cmake pkg-config libx11-dev libxtst-dev libpng++-dev`
  },
  mac: {
    title: "Mac desktop prerequisites",
    label: "Homebrew + CMake",
    note: "Steps 2 and 3 are only for optional local desktop support. If Homebrew is not installed, install it first with the command shown in Step 2, then run brew install cmake. macOS may also ask for Accessibility and Screen Recording permissions when local desktop control starts. Step 4 is only for Docker CLI and Docker desktop support. Step 5 is only for QEMU virtual CLI and virtual desktop support.",
    commands: `# Only for optional local desktop support
# If Homebrew is not installed, install it first:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

xcode-select --install
brew install cmake`
  },
  win: {
    title: "Windows desktop prerequisites",
    label: "Build tools",
    note: "Steps 2 and 3 are only for optional local desktop support. Run these from a terminal where CMake and the Visual Studio C++ tools are available on PATH. Step 4 is only for Docker CLI and Docker desktop support. Step 5 is only for QEMU virtual CLI and virtual desktop support.",
    commands: `# Only for optional local desktop support
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Kitware.CMake --exact --source winget`
  }
};

const dockerCommands = {
  linux: {
    label: "Ubuntu Docker",
    commands: `# Only for optional Docker CLI and Docker desktop support
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
sudo docker run hello-world
sudo usermod -aG docker $USER`
  },
  mac: {
    label: "Docker Desktop for Mac",
    commands: `# Only for optional Docker CLI and Docker desktop support
# Install Docker Desktop from Docker's official website:
https://docs.docker.com/desktop/setup/install/mac-install/`
  },
  win: {
    label: "Docker Desktop for Windows",
    commands: `# Only for optional Docker CLI and Docker desktop support
# Install Docker Desktop from Docker's official website:
https://docs.docker.com/desktop/setup/install/windows-install/`
  }
};

function enhanceCodeBlockCopyButtons() {
  for (const code of document.querySelectorAll("pre > code")) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.copyEnhanced === "true") continue;
    if (pre.closest(".hero-code")) continue;
    if (pre.closest(".example-response")) continue;
    if (pre.closest(".install-shell")) continue;

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
  const installCopyButton = event.target.closest("[data-install-copy]");
  const codeCopyButton = event.target.closest(".code-copy-button");
  const button = copyButton ?? installCopyButton ?? codeCopyButton;

  if (button) {
    const code = codeCopyButton?.closest("pre")?.querySelector("code");
    const installCopyTarget = installCopyButton?.getAttribute("data-install-copy");
    const installCode =
      installCopyTarget === "docker"
        ? document.querySelector("#install-docker-commands")
        : installCopyTarget === "os"
          ? document.querySelector("#install-os-commands")
          : null;
    const value = copyButton?.getAttribute("data-copy") ?? installCode?.textContent ?? code?.textContent ?? "";

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

  const installTab = event.target.closest("[data-install-os]");
  if (installTab) {
    const os = installTab.getAttribute("data-install-os");
    const install = installCommands[os];
    const docker = dockerCommands[os];
    if (!install || !docker) return;

    for (const button of document.querySelectorAll("[data-install-os]")) {
      const active = button === installTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }

    const title = document.querySelector("#install-os-title");
    const label = document.querySelector("#install-os-shell-label");
    const commands = document.querySelector("#install-os-commands");
    const note = document.querySelector("#install-os-note");
    const dockerLabel = document.querySelector("#install-docker-shell-label");
    const dockerCommandsBlock = document.querySelector("#install-docker-commands");
    if (title) title.textContent = install.title;
    if (label) label.textContent = install.label;
    if (commands) commands.textContent = install.commands;
    if (note) note.textContent = install.note;
    if (dockerLabel) dockerLabel.textContent = docker.label;
    if (dockerCommandsBlock) dockerCommandsBlock.textContent = docker.commands;
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
