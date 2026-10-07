import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "resources", "native", "macos", "AppEnvironmentBadgeNative.mm");
const output = join(root, "resources", "native", "macos", "app-environment-badge-native.node");
const windowsSandboxSource = join(root, "resources", "native", "windows", "PluginSandboxLauncher.cpp");
const windowsSandboxOutput = join(root, "resources", "native", "windows", "codex-switcher-plugin-sandbox.exe");
const repoRoot = join(root, "..", "..");
const staleHelper = join(root, "resources", "native", "macos", "codex-switcher-dock-badge-helper");
const macArchitectures = ["arm64", "x86_64"];

if (existsSync(staleHelper)) unlinkSync(staleHelper);

if (process.platform === "darwin" && existsSync(source)) {
  mkdirSync(dirname(output), { recursive: true });
  const macSdkPath = execFileSync("xcrun", ["--show-sdk-path"], {
    encoding: "utf8",
  }).trim();
  execFileSync("xcrun", [
    "clang++", ...macArchitectures.flatMap((architecture) => ["-arch", architecture]),
    "-std=c++17", "-fobjc-arc", "-shared", "-undefined", "dynamic_lookup",
    "-isystem", join(macSdkPath, "usr", "include", "c++", "v1"),
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

if (process.platform === "win32" && existsSync(windowsSandboxSource)) {
  mkdirSync(dirname(windowsSandboxOutput), { recursive: true });
  const compilerArgs = [
    "/nologo", "/std:c++17", "/EHsc", "/O2", windowsSandboxSource,
    `/Fe:${windowsSandboxOutput}`,
    "/link", "Advapi32.lib", "Userenv.lib", "Shell32.lib",
  ];
  try {
    execFileSync("where.exe", ["cl.exe"], { stdio: "ignore" });
    execFileSync("cl.exe", compilerArgs, { stdio: "inherit" });
  } catch {
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const vswhere = join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
    if (!existsSync(vswhere)) throw new Error("MSVC cl.exe is unavailable and vswhere.exe was not found");
    const installationPath = execFileSync(vswhere, [
      "-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath",
    ], { encoding: "utf8" }).trim();
    if (!installationPath) throw new Error("MSVC installation with VC.Tools.x86.x64 was not found");
    const vsDevCmd = join(installationPath, "Common7", "Tools", "VsDevCmd.bat");
    const quoteCmd = (value) => `"${String(value)}"`;
    const command = `call ${quoteCmd(vsDevCmd)} -arch=x64 && cl.exe ${compilerArgs.map(quoteCmd).join(" ")}`;
    execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], {
      stdio: "inherit",
      windowsVerbatimArguments: true,
    });
  }
}
