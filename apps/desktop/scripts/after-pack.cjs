const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  // A configured distribution identity is applied by electron-builder after
  // this hook. The fallback below is only for local and unsigned CI packages.
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  execFileSync("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--timestamp=none",
    appPath,
  ], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ], { stdio: "inherit" });
};
