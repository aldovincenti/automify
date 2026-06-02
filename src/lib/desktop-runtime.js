import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DESKTOP_RUNTIME_PACKAGE = "@nut-tree/nut-js";
export const DESKTOP_RUNTIME_MANIFEST = "automify-desktop-runtime.json";

export function desktopRuntimeRefs(env = process.env) {
  return {
    nut: env.AUTOMIFY_DESKTOP_NUT_REF ?? "e413fa1f19a19c4631812e4e1eaf47aa732b5cbe",
    libnutCore: env.AUTOMIFY_DESKTOP_LIBNUT_CORE_REF ?? "6bbe5825f1123bcd740117ca932c8b1c6cffb48c",
    macPermissions: env.AUTOMIFY_DESKTOP_MAC_PERMISSIONS_REF ?? "6b6ddee993ddce5071b637e42f6ee1434150d0bb"
  };
}

export function desktopRuntimeCompatibility(env = process.env) {
  const refs = desktopRuntimeRefs(env);
  return {
    platform: process.platform,
    arch: process.arch,
    nodeAbi: process.versions.modules,
    nutRef: refs.nut,
    libnutCoreRef: refs.libnutCore,
    macPermissionsRef: process.platform === "darwin" ? refs.macPermissions : undefined
  };
}

export function desktopRuntimeKey(compatibility = desktopRuntimeCompatibility()) {
  return [
    compatibility.platform,
    compatibility.arch,
    `node-${compatibility.nodeAbi}`,
    `nut-${shortRef(compatibility.nutRef)}`,
    `libnut-${shortRef(compatibility.libnutCoreRef)}`,
    compatibility.macPermissionsRef ? `macperms-${shortRef(compatibility.macPermissionsRef)}` : null
  ]
    .filter(Boolean)
    .join("-");
}

export function defaultDesktopRuntimeRoot(env = process.env) {
  if (env.AUTOMIFY_DESKTOP_RUNTIME_DIR) {
    return resolve(env.AUTOMIFY_DESKTOP_RUNTIME_DIR);
  }

  if (process.platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "automify", "desktop-runtime");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "automify", "desktop-runtime");
  }

  return join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "automify", "desktop-runtime");
}

export function desktopRuntimeDir(env = process.env) {
  return join(defaultDesktopRuntimeRoot(env), desktopRuntimeKey(desktopRuntimeCompatibility(env)));
}

export function desktopRuntimeNodeModules(env = process.env) {
  return join(desktopRuntimeDir(env), "node_modules");
}

export function desktopRuntimePackageJsonPath(env = process.env) {
  return join(desktopRuntimeNodeModules(env), "@nut-tree", "nut-js", "package.json");
}

export function desktopRuntimeManifestPath(env = process.env) {
  return join(desktopRuntimeDir(env), DESKTOP_RUNTIME_MANIFEST);
}

export function desktopRuntimeManifest(env = process.env) {
  return {
    version: 1,
    package: DESKTOP_RUNTIME_PACKAGE,
    runtimeDir: desktopRuntimeDir(env),
    compatibility: desktopRuntimeCompatibility(env)
  };
}

export function readDesktopRuntimeManifest(env = process.env) {
  const path = desktopRuntimeManifestPath(env);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function findDesktopRuntimeManifests(env = process.env) {
  const root = defaultDesktopRuntimeRoot(env);
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runtimeDir = join(root, entry.name);
      const manifestPath = join(runtimeDir, DESKTOP_RUNTIME_MANIFEST);
      if (!existsSync(manifestPath)) return null;
      try {
        return {
          runtimeDir,
          manifestPath,
          manifest: JSON.parse(readFileSync(manifestPath, "utf8"))
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function desktopRuntimeIsInstalled(env = process.env) {
  const manifest = readDesktopRuntimeManifest(env);
  return desktopRuntimeManifestMatches(manifest, env) && existsSync(desktopRuntimePackageJsonPath(env));
}

export function desktopRuntimeManifestMatches(manifest, env = process.env) {
  if (!manifest || manifest.version !== 1 || manifest.package !== DESKTOP_RUNTIME_PACKAGE) return false;

  const expected = desktopRuntimeCompatibility(env);
  const actual = manifest.compatibility ?? {};
  return (
    actual.platform === expected.platform &&
    actual.arch === expected.arch &&
    actual.nodeAbi === expected.nodeAbi &&
    actual.nutRef === expected.nutRef &&
    actual.libnutCoreRef === expected.libnutCoreRef &&
    actual.macPermissionsRef === expected.macPermissionsRef
  );
}

function shortRef(ref) {
  return String(ref ?? "unknown")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 12);
}
