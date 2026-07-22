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
  assert.equal(desktopPackage.build.nsis?.installerIcon, "build/icon.ico");
  assert.equal(desktopPackage.build.nsis?.uninstallerIcon, "build/icon.ico");
  assert.equal(desktopPackage.build.nsis?.include, "build/installer.nsh");
  const nativeBuildSource = readFileSync(join(desktopRoot, "scripts", "build-native-helpers.mjs"), "utf8");
  assert.match(nativeBuildSource, /AppEnvironmentBadgeNative\.mm/);
  assert.match(nativeBuildSource, /app-environment-badge-native\.node/);
  assert.doesNotMatch(nativeBuildSource, /swiftc/);
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
