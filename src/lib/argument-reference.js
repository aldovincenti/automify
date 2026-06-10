export const argumentReference = [
  {
    surface: ".do()",
    preferred: [
      "data",
      "evaluate",
      "output",
      "limits",
      "request",
      "safety",
      "hooks",
      "screenshots",
      "screenshot",
      "recording",
      "command"
    ],
    notes:
      "Use data for structured JSON, evaluate for files the model should inspect directly, limits.steps to change the max model-action turns, recording to save visual runs with ffmpeg, and command only on CLI surfaces."
  },
  {
    surface: "automify.browser()",
    preferred: [
      "preset",
      "startUrl",
      "browser",
      "viewport",
      "launch",
      "context",
      "navigation",
      "actionDelayMs",
      "logFile"
    ],
    notes:
      'Use preset: "browser-review" for a high-detail, bounded browser inspection run. Use logFile to capture browser and automation events.'
  },
  {
    surface: "automify.cli()",
    preferred: ["preset", "command", "limits", "request", "hooks", "logFile"],
    notes:
      "Factory command policy is the default. Per-run command options override it for a single do() call. Use logFile to append CLI debug events as JSON Lines."
  },
  {
    surface: "automify.dockerCli()",
    preferred: [
      "preset",
      "container",
      "additionalAptPackages",
      "workdir",
      "shared",
      "sharedFiles",
      "command",
      "logFile"
    ],
    notes:
      'Requires Docker to be installed and running. Use additionalAptPackages to apt-install packages before commands run. Use preset: "repo" to mount the current workspace at /workspace and allow common repo commands. Use logFile to capture CLI and Docker container events.'
  },
  {
    surface: "automify.virtualCli()",
    preferred: [
      "preset",
      "vm",
      "ssh",
      "defaultImageCache",
      "additionalAptPackages",
      "workdir",
      "shared",
      "sharedFiles",
      "command",
      "logFile"
    ],
    notes:
      'Creates a QEMU-backed CLI runner. Without image or vm.image, Automify uses the prepared Debian image cache by default; use defaultImageCache to configure or refresh that cache. Use preset: "repo" to expose the current workspace at /workspace.'
  },
  {
    surface: "automify.dockerComputer()",
    preferred: [
      "preset",
      "container",
      "viewport",
      "desktop",
      "additionalAptPackages",
      "shared",
      "sharedFiles",
      "logFile"
    ],
    notes:
      "Creates a Docker-backed Linux desktop runner and requires Docker to be installed and running. Pass startupCommand or desktop.startupCommand to launch the initial app. Use additionalAptPackages to apt-install extra packages. Use logFile to capture automation and Docker desktop events. Explicit container names are locked per name until close()."
  },
  {
    surface: "automify.virtualComputer()",
    preferred: [
      "preset",
      "vm",
      "ssh",
      "viewport",
      "desktop",
      "defaultImageCache",
      "additionalAptPackages",
      "shared",
      "sharedFiles",
      "logFile"
    ],
    notes:
      "Creates a QEMU-backed Linux desktop runner. Without image or vm.image, Automify uses the prepared Debian image cache by default. Pass startupCommand or desktop.startupCommand to launch the initial app; the guest runs Xvfb/openbox/xdotool/scrot over SSH."
  },
  {
    surface: "automify.localComputer()",
    preferred: ["viewport", "mouse", "keyboard", "calibration", "virtualDisplay", "lockResource", "logFile"],
    notes:
      "Creates a local desktop runner and takes an exclusive cross-process lock until close(). Linux local desktop requires X11/Xorg or Xvfb; Wayland is not supported. Use lockResource only for independent desktop sessions or isolated tests. Use logFile to capture automation and local desktop events."
  },
  {
    surface: "createLocalDesktopComputer()",
    preferred: ["viewport", "mouse", "keyboard", "calibration", "virtualDisplay", "lockResource", "logFile"],
    notes:
      "Grouped mouse, keyboard, and calibration options are preferred over the older flat names. Linux local desktop requires X11/Xorg or Xvfb; Wayland is not supported. Local desktop control takes an exclusive cross-process lock until close(); use lockResource only for independent desktop sessions or isolated tests. Use logFile to capture local desktop events."
  },
  {
    surface: "createDockerDesktopComputer()",
    preferred: [
      "preset",
      "container",
      "viewport",
      "desktop",
      "additionalAptPackages",
      "shared",
      "sharedFiles",
      "logFile"
    ],
    notes:
      "Requires Docker to be installed and running. container controls Docker and resource limits; startupCommand or desktop.startupCommand is required; shared/sharedFiles control host file access. Use additionalAptPackages to apt-install extra packages and logFile to capture Docker desktop events."
  },
  {
    surface: "createVirtualDesktopComputer()",
    preferred: [
      "preset",
      "vm",
      "ssh",
      "viewport",
      "desktop",
      "defaultImageCache",
      "additionalAptPackages",
      "shared",
      "sharedFiles",
      "logFile"
    ],
    notes:
      "Requires QEMU. Without image or vm.image, Automify uses the prepared Debian image cache by default. vm controls QEMU, custom images, resources, acceleration, and cache configuration; ssh controls login for custom images; startupCommand or desktop.startupCommand is required."
  }
];
