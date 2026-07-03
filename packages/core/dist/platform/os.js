export function detectPlatform(platform = process.platform) {
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
export function isWindowsPlatform(platform = process.platform) {
    return detectPlatform(platform) === "windows";
}
//# sourceMappingURL=os.js.map