import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "resources", "native", "macos", "AppEnvironmentBadgeNative.mm");
const output = join(root, "resources", "native", "macos", "app-environment-badge-native.node");
const repoRoot = join(root, "..", "..");
const staleHelper = join(root, "resources", "native", "macos", "codex-switcher-dock-badge-helper");

if (existsSync(staleHelper)) unlinkSync(staleHelper);

if (process.platform === "darwin" && existsSync(source)) {
  mkdirSync(dirname(output), { recursive: true });
  execFileSync("xcrun", [
    "clang++", "-std=c++17", "-fobjc-arc", "-shared", "-undefined", "dynamic_lookup",
    "-I", join(repoRoot, "node_modules", "node-addon-api"),
    "-I", join(repoRoot, "node_modules", "node-addon-api", "src"),
    source, "-o", output, "-framework", "AppKit", "-framework", "ApplicationServices",
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: process.env.CODEX_SWITCHER_CLANG_CACHE_PATH || join("/tmp", "codex-switcher-clang-cache"),
    },
  });
}
