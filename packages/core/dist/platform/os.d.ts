export type SwitcherPlatform = "windows" | "macos" | "linux" | "unknown";
export declare function detectPlatform(platform?: NodeJS.Platform): SwitcherPlatform;
export declare function isWindowsPlatform(platform?: NodeJS.Platform): boolean;
