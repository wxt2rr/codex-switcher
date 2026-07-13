import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { getCodexToolStatus, resetCodexToolPath, saveCodexToolPath } from "./codex-tool-paths.js";
async function executable(path: string) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, "#!/bin/sh\necho codex-cli 1.0\n"); await chmod(path, 0o755); }
test("CLI detection prefers an executable found on PATH", async () => { const root = await mkdtemp(join(tmpdir(), "codex-tools-")); const bin = join(root, "bin"); const cli = join(bin, "codex"); await executable(cli); const status = await getCodexToolStatus("cli", { settingsPath: join(root, "settings.json"), env: { HOME: root, PATH: [bin, "/bin"].join(delimiter) }, platform: "darwin" }); assert.equal(status.path, cli); assert.equal(status.source, "path"); });
test("manual CLI path persists and reset restores automatic detection", async () => { const root = await mkdtemp(join(tmpdir(), "codex-tools-")); const automatic = join(root, "auto", "codex"); const manual = join(root, "manual", "codex"); await executable(automatic); await executable(manual); const options = { settingsPath: join(root, "settings.json"), env: { HOME: root, PATH: join(root, "auto") }, platform: "darwin" as const, validateCli: async () => undefined }; assert.equal((await saveCodexToolPath("cli", manual, options)).source, "manual"); assert.equal((await resetCodexToolPath("cli", options)).path, automatic); });
test("invalid manual App path is rejected", async () => { const root = await mkdtemp(join(tmpdir(), "codex-tools-")); await assert.rejects(() => saveCodexToolPath("app", join(root, "missing"), { settingsPath: join(root, "settings.json"), env: { HOME: root }, platform: "darwin" }), /not executable/); });
test("macOS App bundle directory resolves its internal executable", async () => { const root = await mkdtemp(join(tmpdir(), "codex-tools-")); const bundle = join(root, "Codex.app"); const app = join(bundle, "Contents", "MacOS", "Codex"); await executable(app); const status = await saveCodexToolPath("app", bundle, { settingsPath: join(root, "settings.json"), env: { HOME: root }, platform: "darwin" }); assert.equal(status.path, app); });
test("Windows CLI detection resolves codex.exe from PATH", async () => { const root = await mkdtemp(join(tmpdir(), "codex-tools-")); const bin = join(root, "bin"); const cli = join(bin, "codex.exe"); await executable(cli); const status = await getCodexToolStatus("cli", { settingsPath: join(root, "settings.json"), env: { USERPROFILE: root, PATH: bin }, platform: "win32" }); assert.equal(status.path, cli); assert.equal(status.source, "path"); });

test("macOS App detection reads the bundle executable from Info.plist", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-tools-"));
  const bundle = join(root, "Applications", "Codex.app");
  const app = join(bundle, "Contents", "MacOS", "Codex Desktop");
  await executable(app);
  await writeFile(join(bundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Codex Desktop</string></dict></plist>`);

  const status = await getCodexToolStatus("app", {
    settingsPath: join(root, "settings.json"),
    env: { HOME: root },
    platform: "darwin",
  });

  assert.equal(status.path, app);
  assert.equal(status.source, "candidate");
});

test("Windows App detection resolves the WindowsApps execution alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-tools-"));
  const aliasDir = join(root, "AppData", "Local", "Microsoft", "WindowsApps");
  const app = join(aliasDir, "Codex.exe");
  await executable(app);

  const status = await getCodexToolStatus("app", {
    settingsPath: join(root, "settings.json"),
    env: { USERPROFILE: root, LOCALAPPDATA: join(root, "AppData", "Local"), PATH: aliasDir },
    platform: "win32",
  });

  assert.equal(status.path, app);
  assert.equal(status.source, "path");
});

test("macOS App detection supports the merged ChatGPT Codex bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-tools-"));
  const bundle = join(root, "Applications", "ChatGPT.app");
  const app = join(bundle, "Contents", "MacOS", "ChatGPT");
  await executable(app);
  await writeFile(join(bundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.openai.codex</string><key>CFBundleExecutable</key><string>ChatGPT</string></dict></plist>`);

  const status = await getCodexToolStatus("app", {
    settingsPath: join(root, "settings.json"),
    env: { HOME: root },
    platform: "darwin",
  });

  assert.equal(status.path, app);
  assert.equal(status.source, "candidate");
});

test("Windows App detection supports the merged ChatGPT execution alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-tools-"));
  const aliasDir = join(root, "AppData", "Local", "Microsoft", "WindowsApps");
  const app = join(aliasDir, "ChatGPT.exe");
  await executable(app);

  const status = await getCodexToolStatus("app", {
    settingsPath: join(root, "settings.json"),
    env: { USERPROFILE: root, LOCALAPPDATA: join(root, "AppData", "Local"), PATH: aliasDir },
    platform: "win32",
  });

  assert.equal(status.path, app);
  assert.equal(status.source, "path");
});

test("Windows App detection falls back to the ChatGPT packaged AppID", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-tools-"));
  const status = await getCodexToolStatus("app", {
    settingsPath: join(root, "settings.json"),
    env: { USERPROFILE: root, LOCALAPPDATA: join(root, "AppData", "Local"), PATH: "" },
    platform: "win32",
    detectWindowsPackagedApp: async () => "OpenAI.Codex_2p2nqsd0c76g0!App",
  });

  assert.equal(status.path, "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App");
  assert.equal(status.source, "candidate");
  assert.equal(status.available, true);
});

test("Windows App settings accept a packaged AppID as a manual target", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-tools-"));
  const status = await saveCodexToolPath("app", "OpenAI.Codex_2p2nqsd0c76g0!App", {
    settingsPath: join(root, "settings.json"),
    env: { USERPROFILE: root, LOCALAPPDATA: join(root, "AppData", "Local"), PATH: "" },
    platform: "win32",
    detectWindowsPackagedApp: async () => "",
  });

  assert.equal(status.path, "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App");
  assert.equal(status.source, "manual");
});

test("Windows App settings reject malformed packaged AppID targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-tools-"));
  await assert.rejects(
    () => saveCodexToolPath("app", "shell:AppsFolder\\OpenAI.Codex!App & calc.exe", {
      settingsPath: join(root, "settings.json"),
      env: { USERPROFILE: root, LOCALAPPDATA: join(root, "AppData", "Local"), PATH: "" },
      platform: "win32",
      detectWindowsPackagedApp: async () => "",
    }),
    /path is not executable/,
  );
});
