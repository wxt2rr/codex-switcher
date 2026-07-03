export type SwitcherPlatform = "windows" | "macos" | "linux" | "unknown";

export function detectPlatform(platform = process.platform): SwitcherPlatform {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "linux") {
    return "linux";
  }
  return "unknown";
}

export function isWindowsPlatform(platform = process.platform): boolean {
  return detectPlatform(platform) === "windows";
}
