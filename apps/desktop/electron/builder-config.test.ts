import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const desktopRoot = existsSync(join(process.cwd(), "apps", "desktop", "package.json"))
  ? join(process.cwd(), "apps", "desktop")
  : process.cwd();

const desktopPackage = JSON.parse(
  readFileSync(join(desktopRoot, "package.json"), "utf8")
) as {
  main: string;
  homepage?: string;
  scripts: Record<string, string>;
  build: {
    afterPack?: string;
    appId: string;
    files: string[];
    extraResources: Array<{
      from: string;
      to: string;
    }>;
    mac?: {
      target?: string[];
      icon?: string;
    };
    win?: {
      target?: string[];
      icon?: string;
    };
    linux?: {
      target?: string[];
      category?: string;
      maintainer?: string;
      icon?: string;
    };
    nsis?: {
      installerIcon?: string;
      uninstallerIcon?: string;
      include?: string;
    };
  };
};

test("desktop package defines electron packaging entrypoints", () => {
  assert.equal(desktopPackage.main, "electron-dist/electron/main.cjs");
  assert.equal(desktopPackage.build.afterPack, "scripts/after-pack.cjs");
  assert.equal(desktopPackage.scripts["package:dir"], "electron-builder --dir");
  assert.equal(desktopPackage.scripts["package:mac"], "electron-builder --mac dmg zip --arm64 --x64");
  assert.equal(desktopPackage.scripts["package:mac:dir"], "electron-builder --mac dir --arm64 --x64");
  assert.equal(desktopPackage.scripts["package:win"], "electron-builder --win nsis --x64");
  assert.equal(desktopPackage.build.appId, "com.wangxt.codex-switcher");
  assert.deepEqual(desktopPackage.build.files, ["dist/**", "electron-dist/**", "package.json"]);
  assert.deepEqual(desktopPackage.build.extraResources, [
    {
      from: "../../packages/core/dist",
      to: "packages/core/dist",
    },
    {
      from: "../../packages/core/package.json",
      to: "packages/core/package.json",
    },
    {
      from: "../../packages/gateway/dist",
      to: "packages/gateway/dist",
    },
    {
      from: "../../packages/gateway/package.json",
      to: "packages/gateway/package.json",
    },
    {
      from: "../../plugins/codex-switcher/scripts",
      to: "plugins/codex-switcher/scripts",
    },
    {
      from: "../../scripts/bin",
      to: "scripts/bin",
    },
    {
      from: "resources/skills",
      to: "skills",
    },
    {
      from: "resources/native",
      to: "native",
    },
  ]);
  assert.deepEqual(desktopPackage.build.mac?.target, ["dmg", "zip", "dir"]);
  assert.equal(desktopPackage.build.mac?.icon, "build/icon.icns");
  assert.deepEqual(desktopPackage.build.win?.target, ["nsis"]);
  assert.equal(desktopPackage.build.win?.icon, "build/icon.ico");
  assert.deepEqual(desktopPackage.build.linux?.target, ["AppImage", "deb"]);
  assert.equal(desktopPackage.build.linux?.category, "Utility");
  assert.equal(desktopPackage.homepage, "https://github.com/wxt2rr/codex-switcher");
  assert.equal(desktopPackage.build.linux?.maintainer, "wangxt");
  assert.equal(desktopPackage.build.linux?.icon, "build/icon.png");
  assert.equal(desktopPackage.build.nsis?.installerIcon, "build/icon.ico");
  assert.equal(desktopPackage.build.nsis?.uninstallerIcon, "build/icon.ico");
  assert.equal(desktopPackage.build.nsis?.include, "build/installer.nsh");
  const nativeBuildSource = readFileSync(join(desktopRoot, "scripts", "build-native-helpers.mjs"), "utf8");
  assert.match(nativeBuildSource, /AppEnvironmentBadgeNative\.mm/);
  assert.match(nativeBuildSource, /app-environment-badge-native\.node/);
  assert.match(nativeBuildSource, /\["arm64", "x86_64"\]/);
  assert.doesNotMatch(nativeBuildSource, /swiftc/);
  assert.match(nativeBuildSource, /PluginSandboxLauncher\.cpp/);
  assert.match(nativeBuildSource, /codex-switcher-plugin-sandbox\.exe/);
  assert.match(nativeBuildSource, /vswhere\.exe/);
  assert.match(nativeBuildSource, /windowsVerbatimArguments: true/);
  assert.doesNotMatch(nativeBuildSource, /replaceAll\('\"', '\"\"'\)/);
  const windowsSandboxSource = readFileSync(join(desktopRoot, "resources", "native", "windows", "PluginSandboxLauncher.cpp"), "utf8");
  assert.match(windowsSandboxSource, /CreateAppContainerProfile/);
  assert.match(windowsSandboxSource, /DeriveAppContainerSidFromAppContainerName/);
  assert.match(windowsSandboxSource, /kernelbase\.dll/);
  assert.match(windowsSandboxSource, /userenv\.dll/);
  assert.match(windowsSandboxSource, /GetProcAddress/);
  assert.match(windowsSandboxSource, /FreeSid\(appContainerSid\)/);
  assert.doesNotMatch(windowsSandboxSource, /AppContainerDeriveSidFromMoniker/);
  assert.match(windowsSandboxSource, /PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES/);
  assert.match(windowsSandboxSource, /internetClient/);
  assert.match(windowsSandboxSource, /nodeDirectory/);
  assert.match(windowsSandboxSource, /Node runtime directory/);
  assert.match(windowsSandboxSource, /REVOKE_ACCESS/);
  assert.match(windowsSandboxSource, /currentDacl/);
  assert.doesNotMatch(windowsSandboxSource, /originalDacl/);
  assert.match(windowsSandboxSource, /FILE_TRAVERSE/);
  assert.match(windowsSandboxSource, /grantDirectoryAncestors/);
  const nativeModuleSource = readFileSync(join(desktopRoot, "resources", "native", "macos", "AppEnvironmentBadgeNative.mm"), "utf8");
  assert.match(nativeModuleSource, /hidesOnDeactivate = NO/);
  assert.match(nativeModuleSource, /canHide = NO/);
  assert.match(nativeModuleSource, /NSWindowStyleMaskNonactivatingPanel/);
  assert.match(nativeModuleSource, /NSWindowAnimationBehaviorNone/);
  assert.match(nativeModuleSource, /NSWindowCollectionBehaviorStationary/);
  assert.match(nativeModuleSource, /NSWindowCollectionBehaviorCanJoinAllSpaces/);
  assert.match(nativeModuleSource, /NSWindowCollectionBehaviorIgnoresCycle/);
  assert.match(nativeModuleSource, /NSWindowCollectionBehaviorFullScreenPrimary/);
  assert.match(nativeModuleSource, /NSWindowCollectionBehaviorFullScreenDisallowsTiling/);
  assert.doesNotMatch(nativeModuleSource, /NSWindowCollectionBehaviorFullScreenNone/);
  assert.doesNotMatch(nativeModuleSource, /NSWindowCollectionBehaviorFullScreenAuxiliary/);
  assert.doesNotMatch(nativeModuleSource, /NSWindowCollectionBehaviorCanJoinAllApplications/);
  assert.match(nativeModuleSource, /AXObserverCreate/);
  assert.match(nativeModuleSource, /kAXMovedNotification/);
  assert.match(nativeModuleSource, /kAXHiddenAttribute/);
  assert.match(nativeModuleSource, /IsTargetDockApplication/);
  assert.match(nativeModuleSource, /isEqualToString:@"codex"/);
  assert.match(nativeModuleSource, /isEqualToString:@"chatgpt"/);
  assert.match(nativeModuleSource, /kAXApplicationDockItemSubrole/);
  assert.doesNotMatch(nativeModuleSource, /containsString:@"codex"/);
  assert.match(nativeModuleSource, /CGWindowListCopyWindowInfo/);
  assert.match(nativeModuleSource, /CGRectIntersection/);
  assert.match(nativeModuleSource, /matchesFullscreenSize/);
  assert.match(nativeModuleSource, /NSWorkspaceActiveSpaceDidChangeNotification/);
  assert.match(nativeModuleSource, /CGDisplayBounds/);
  assert.match(nativeModuleSource, /sortAlongY/);
  assert.match(nativeModuleSource, /DockRectsMoveOutward/);
  assert.match(nativeModuleSource, /gSuppressForDockTransition/);
  assert.match(nativeModuleSource, /350 \* NSEC_PER_MSEC/);
  assert.match(nativeModuleSource, /CGEventTapCreate/);
  assert.match(nativeModuleSource, /kCGEventTapOptionListenOnly/);
  assert.match(nativeModuleSource, /kCGEventScrollWheel/);
  assert.match(nativeModuleSource, /NSEventMaskSwipe/);
  assert.match(nativeModuleSource, /NSEventTypeSwipe/);
  assert.match(nativeModuleSource, /gGlobalGestureMonitor/);
  assert.match(nativeModuleSource, /gLocalGestureMonitor/);
  assert.doesNotMatch(nativeModuleSource, /NSEventMaskKeyDown/);
  assert.doesNotMatch(nativeModuleSource, /NSEventModifierFlagControl/);
  assert.match(nativeModuleSource, /gGlobalScrollFallbackMonitor/);
  const installerInclude = readFileSync(join(desktopRoot, "build", "installer.nsh"), "utf8");
  assert.match(installerInclude, /!macro customCheckAppRunning/);
  assert.match(installerInclude, /taskkill\.exe/);
  assert.match(installerInclude, /\/F \/T \/IM/);
  assert.match(installerInclude, /APP_EXECUTABLE_FILENAME/);
  assert.match(installerInclude, /nsProcess::FindProcess/);
  const afterPackSource = readFileSync(join(desktopRoot, "scripts", "after-pack.cjs"), "utf8");
  assert.match(afterPackSource, /codesign/);
  assert.match(afterPackSource, /--deep/);
  assert.match(afterPackSource, /--timestamp=none/);
  assert.match(afterPackSource, /CSC_LINK/);
  const packageVerifierSource = readFileSync(join(desktopRoot, "scripts", "verify-package-artifact.mjs"), "utf8");
  assert.match(packageVerifierSource, /--verify/);
  assert.match(packageVerifierSource, /--strict/);
});
