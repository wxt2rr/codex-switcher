import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  __testUtils,
} from "./bridge.js";

async function writeFileRecursive(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

test("electron bridge resolves log paths from env overrides and defaults", () => {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousSwitchLog = process.env.CODEX_SWITCHER_SWITCH_LOG;
  const previousRefreshLog = process.env.CODEX_SWITCHER_TOKEN_REFRESH_LOG;
  const testHome = join(tmpdir(), "codex-switcher-test-home");

  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;
  process.env.CODEX_SWITCHER_SWITCH_LOG = "/tmp/custom-switcher.log";
  process.env.CODEX_SWITCHER_TOKEN_REFRESH_LOG = "/tmp/custom-token-refresh.log";

  assert.equal(__testUtils.resolveLogPath("switcher"), "/tmp/custom-switcher.log");
  assert.equal(__testUtils.resolveLogPath("token-refresh"), "/tmp/custom-token-refresh.log");

  delete process.env.CODEX_SWITCHER_SWITCH_LOG;
  delete process.env.CODEX_SWITCHER_TOKEN_REFRESH_LOG;

  assert.equal(__testUtils.resolveLogPath("switcher"), join(testHome, ".codex-switcher", "switcher.log"));
  assert.equal(__testUtils.resolveLogPath("token-refresh"), join(testHome, ".codex-switcher", "token-refresh.log"));
  assert.throws(() => __testUtils.resolveLogPath("unknown"), /unsupported log kind/);

  if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
  if (previousSwitchLog === undefined) delete process.env.CODEX_SWITCHER_SWITCH_LOG;
  else process.env.CODEX_SWITCHER_SWITCH_LOG = previousSwitchLog;
  if (previousRefreshLog === undefined) delete process.env.CODEX_SWITCHER_TOKEN_REFRESH_LOG;
  else process.env.CODEX_SWITCHER_TOKEN_REFRESH_LOG = previousRefreshLog;
});

test("electron bridge validates sub2api payloads before account artifact generation", () => {
  assert.throws(() => __testUtils.parseSub2ApiPayload(""), /sub2api JSON is required/);
  assert.throws(() => __testUtils.parseSub2ApiPayload("{bad json}"), /invalid sub2api JSON/);
  assert.throws(() => __testUtils.buildSub2ApiAuthJson({ id_token: "id-only" }), /missing access_token/);
  assert.throws(() => __testUtils.buildSub2ApiAuthJson({ access_token: "access-only" }), /missing id_token/);

  assert.deepEqual(
    __testUtils.buildSub2ApiAuthJson({
      access_token: "access-token",
      id_token: "id-token",
      refresh_token: "refresh-token",
    }),
    {
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access-token",
        id_token: "id-token",
      },
      refresh_token: "refresh-token",
    },
  );
});

test("electron bridge plans post-switch follow-up actions by target", () => {
  assert.deepEqual(__testUtils.buildPostSwitchActions("app"), [
    {
      kind: "switcher",
      args: ["app", "restart-current"],
    },
  ]);
  assert.deepEqual(__testUtils.buildPostSwitchActions("cli"), [
    {
      kind: "terminal",
      args: ["cli", "launch-current"],
    },
  ]);
});

test("electron bridge launches a new cli session after switching the cli target account", () => {
  assert.equal(__testUtils.shouldLaunchCliAfterAccountSwitch("cli"), true);
  assert.equal(__testUtils.shouldLaunchCliAfterAccountSwitch("app"), false);
});

test("electron bridge returns a shell-neutral launch message for the CLI", async () => {
  assert.equal(__testUtils.getCliLaunchSuccessMessage(), "Opened CLI session");
});

test("electron bridge builds macOS terminal launch attempts for the CLI", () => {
  const plan = __testUtils.buildCliTerminalLaunchPlan({
    repoRoot: "/Users/tester/work/codex-switcher",
    codexHome: "/Users/tester/.codex-envs/project/home",
    codexBin: "/Applications/Codex.app/Contents/Resources/codex",
    platform: "darwin",
    env: { CODEX_SWITCHER_MACOS_TERMINAL: "iterm" },
  });

  assert.equal(plan.platform, "macos");
  assert.equal(plan.attempts.length, 1);
  assert.equal(plan.attempts[0]?.command, "osascript");
  assert.match(plan.attempts[0]?.args[1] ?? "", /tell application "iTerm"/);
  assert.match(plan.attempts[0]?.args[1] ?? "", /CODEX_HOME/);
});

test("electron bridge starts a new CLI window in the selected project directory", () => {
  const macPlan = __testUtils.buildCliTerminalLaunchPlan({
    repoRoot: "/Applications/codex-switcher.app/Contents/Resources",
    workingDirectory: "/Users/tester/work/client's app",
    codexHome: "/Users/tester/.codex-envs/project/home",
    codexBin: "/opt/homebrew/bin/codex",
    platform: "darwin",
    env: { CODEX_SWITCHER_MACOS_TERMINAL: "terminal" },
  });
  const macScript = macPlan.attempts[0]?.args[1] ?? "";
  assert.match(macScript, /cd '\/Users\/tester\/work\/client/);
  assert.match(macScript, /s app/);
  assert.doesNotMatch(macScript, /Applications\/codex-switcher\.app\/Contents\/Resources/);

  const windowsPlan = __testUtils.buildCliTerminalLaunchPlan({
    repoRoot: "C:\\Program Files\\codex-switcher\\resources",
    workingDirectory: "D:\\Work\\Client App",
    codexHome: "C:\\Users\\tester\\.codex",
    codexBin: "C:\\Tools\\codex.exe",
    platform: "win32",
    env: { CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER: "powershell" },
  });
  assert.match(windowsPlan.attempts[0]?.args.join(" ") ?? "", /Set-Location 'D:\\Work\\Client App'/);
});

test("electron bridge selects Terminal without a side-effecting iTerm fallback", () => {
  const plan = __testUtils.buildCliTerminalLaunchPlan({
    repoRoot: "/Users/tester/work/codex-switcher",
    codexHome: "/Users/tester/.codex-envs/project/home",
    codexBin: "/Applications/Codex.app/Contents/Resources/codex",
    platform: "darwin",
    env: { CODEX_SWITCHER_MACOS_TERMINAL: "terminal" },
  });

  assert.equal(plan.attempts.length, 1);
  const terminalScript = plan.attempts[0]?.args[1] ?? "";
  assert.match(terminalScript, /tell application "Terminal"/);
  assert.doesNotMatch(terminalScript, /tell application "iTerm"/);
  assert.match(terminalScript, /set terminalWasRunning to application "Terminal" is running/);
  assert.match(terminalScript, /if terminalWasRunning then/);
  assert.match(terminalScript, /else\nlaunch\ndo script/);
  assert.doesNotMatch(terminalScript, /repeat 50 times/);
  assert.equal((terminalScript.match(/do script/g) ?? []).length, 2);
});

test("electron bridge coalesces duplicate terminal launches within the debounce window", async () => {
  const gate = __testUtils.createTerminalLaunchGate(2_000);
  let launches = 0;
  const launch = async () => { launches += 1; };

  const first = gate.run("new-window:/project", launch, 1_000);
  const duplicate = gate.run("new-window:/project", launch, 1_500);
  await Promise.all([first, duplicate]);
  assert.equal(launches, 1);

  await gate.run("new-window:/other", launch, 1_600);
  await gate.run("new-window:/project", launch, 3_100);
  assert.equal(launches, 3);
});

test("electron bridge restarts only the current macOS terminal session", () => {
  const plan = __testUtils.buildCliTerminalLaunchPlan({
    repoRoot: "/Users/tester/work/codex-switcher",
    codexHome: "/Users/tester/.codex-envs/project/home",
    codexBin: "/Applications/Codex.app/Contents/Resources/codex",
    platform: "darwin",
    launchMode: "current-window",
    env: { CODEX_SWITCHER_MACOS_TERMINAL: "iterm" },
  });

  const iTermScript = plan.attempts[0]?.args[1] ?? "";
  assert.doesNotMatch(iTermScript, /cd '\/Users\/tester\/work\/codex-switcher'/);
  assert.match(iTermScript, /set targetSession to current session of current window/);
  assert.match(iTermScript, /set targetTty to tty of targetSession/);
  assert.match(iTermScript, /write text .*\/exit/);
  assert.match(iTermScript, /if existingCodexProcesses is not "" then/);
  assert.match(iTermScript, /ps -t/);
  assert.match(iTermScript, /codex-switcher\|codex-code-mode-host/);
  assert.match(iTermScript, /awk/);
  assert.match(iTermScript, /Codex CLI did not exit/);
  assert.doesNotMatch(iTermScript, /tell every session/);

  const terminalPlan = __testUtils.buildCliTerminalLaunchPlan({
    repoRoot: "/Users/tester/work/codex-switcher",
    codexHome: "/Users/tester/.codex-envs/project/home",
    codexBin: "/Applications/Codex.app/Contents/Resources/codex",
    platform: "darwin",
    launchMode: "current-window",
    env: { CODEX_SWITCHER_MACOS_TERMINAL: "terminal" },
  });
  const terminalScript = terminalPlan.attempts[0]?.args[1] ?? "";
  assert.match(terminalScript, /set targetTab to selected tab of front window/);
  assert.match(terminalScript, /set targetTty to tty of targetTab/);
  assert.match(terminalScript, /do script .*\/exit.* in targetTab/);
  assert.match(terminalScript, /if existingCodexProcesses is not "" then/);
  assert.match(terminalScript, /ps -t/);
  assert.doesNotMatch(terminalScript, /every tab/);
});

test("electron bridge builds Windows Terminal launch attempts for the CLI", () => {
  const plan = __testUtils.buildCliTerminalLaunchPlan({
    repoRoot: "C:\\Users\\tester\\codex-switcher",
    codexHome: "C:\\Users\\tester\\.codex-envs\\project\\home",
    codexBin: "C:\\Users\\tester\\AppData\\Local\\Programs\\Codex\\codex.exe",
    platform: "win32",
    env: {
      CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER: "wt",
    },
  });

  assert.equal(plan.platform, "windows");
  assert.equal(plan.attempts.length, 1);
  assert.equal(plan.attempts[0]?.command, "wt.exe");
  assert.deepEqual(plan.attempts[0]?.args.slice(0, 7), [
    "-w",
    "new",
    "powershell.exe",
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
  ]);
  assert.match(plan.attempts[0]?.args[7] ?? "", /\$env:CODEX_HOME/);
  assert.match(plan.attempts[0]?.args[7] ?? "", /codex\.exe/);
});

test("electron bridge builds PowerShell launch attempts for the CLI on Windows", () => {
  const plan = __testUtils.buildCliTerminalLaunchPlan({
    repoRoot: "C:\\Users\\tester\\codex-switcher",
    codexHome: "C:\\Users\\tester\\.codex\\home",
    codexBin: "codex.exe",
    platform: "win32",
    env: {
      CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER: "powershell",
    },
  });

  assert.equal(plan.platform, "windows");
  assert.equal(plan.attempts[0]?.command, "powershell.exe");
  assert.match(plan.attempts[0]?.args.join(" "), /Set-Location/);
  assert.match(plan.attempts[0]?.args.join(" "), /\$env:CODEX_HOME/);
  assert.match(plan.attempts[0]?.args.join(" "), /codex\.exe/);
});

test("electron bridge defaults to PowerShell for CLI launch on Windows", () => {
  const plan = __testUtils.buildCliTerminalLaunchPlan({
    repoRoot: "C:\\Users\\tester\\codex-switcher",
    codexHome: "C:\\Users\\tester\\.codex\\home",
    codexBin: "codex.exe",
    platform: "win32",
    env: {},
  });

  assert.equal(plan.platform, "windows");
  assert.equal(plan.attempts[0]?.command, "powershell.exe");
  assert.match(plan.attempts[0]?.args.join(" "), /Set-Location/);
  assert.match(plan.attempts[0]?.args.join(" "), /\$env:CODEX_HOME/);
  assert.match(plan.attempts[0]?.args.join(" "), /codex\.exe/);
});

test("electron bridge builds a node switcher command on Windows", () => {
  const plan = __testUtils.buildSwitcherExecutionPlan({
    repoRoot: "C:\\Users\\tester\\codex-switcher",
    platform: "win32",
    args: ["ops", "doctor"],
  });

  assert.equal(plan.command, "node");
  assert.match(plan.args[0] ?? "", /scripts[\\/]+bin[\\/]+codex-sw-node\.cjs$/);
  assert.deepEqual(plan.args.slice(1), ["ops", "doctor"]);
});

test("electron bridge keeps the legacy bash switcher command on macOS", () => {
  const plan = __testUtils.buildSwitcherExecutionPlan({
    repoRoot: "/Users/tester/codex-switcher",
    platform: "darwin",
    args: ["ops", "doctor"],
  });

  assert.equal(plan.command, "bash");
  assert.match(plan.args[0] ?? "", /plugins[\\/]codex-switcher[\\/]scripts[\\/]codex-switcher$/);
  assert.deepEqual(plan.args.slice(1), ["ops", "doctor"]);
});

test("electron bridge builds direct api-key login execution on Windows", () => {
  const plan = __testUtils.buildApiKeyLoginExecutionPlan({
    repoRoot: "C:\\Users\\tester\\codex-switcher",
    codexHome: "C:\\Users\\tester\\.codex-envs\\project\\home",
    codexBin: "C:\\Codex\\codex.exe",
    apiKey: "sk-test-123",
    platform: "win32",
  });

  assert.equal(plan.command, "C:\\Codex\\codex.exe");
  assert.deepEqual(plan.args, ["login", "--with-api-key"]);
  assert.equal(plan.env.CODEX_HOME, "C:\\Users\\tester\\.codex-envs\\project\\home");
  assert.equal(plan.stdin, "sk-test-123\n");
});

test("electron bridge builds direct api-key login execution on macOS", () => {
  const plan = __testUtils.buildApiKeyLoginExecutionPlan({
    repoRoot: "/Users/tester/codex-switcher",
    codexHome: "/Users/tester/.codex-envs/project/home",
    codexBin: "/Applications/Codex.app/Contents/Resources/codex",
    apiKey: "sk-live-456",
    platform: "darwin",
  });

  assert.equal(plan.command, "/Applications/Codex.app/Contents/Resources/codex");
  assert.deepEqual(plan.args, ["login", "--with-api-key"]);
  assert.equal(plan.env.CODEX_HOME, "/Users/tester/.codex-envs/project/home");
  assert.equal(plan.stdin, "sk-live-456\n");
});

test("electron bridge derives legacy paths from Windows runtime defaults", () => {
  const options = __testUtils.resolveLegacyOptionsForTest(
    {
      USERPROFILE: "C:\\Users\\tester",
    },
    "win32",
  );

  assert.equal(options.stateDir, join("C:\\Users\\tester", ".codex-switcher"));
  assert.equal(options.envsDir, join("C:\\Users\\tester", ".codex-envs"));
  assert.equal(options.defaultHome, join("C:\\Users\\tester", ".codex"));
});

test("electron bridge derives legacy paths from macOS runtime defaults", () => {
  const options = __testUtils.resolveLegacyOptionsForTest(
    {
      HOME: "/Users/tester",
    },
    "darwin",
  );

  assert.equal(options.stateDir, join("/Users/tester", ".codex-switcher"));
  assert.equal(options.envsDir, join("/Users/tester", ".codex-envs"));
  assert.equal(options.defaultHome, join("/Users/tester", ".codex"));
});

test("electron bridge resolves usage proxy through shared core detection", { skip: process.platform !== "darwin" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-proxy-"));
  const previousEnv = { ...process.env };

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, ".codex-switcher");

    await writeFileRecursive(
      join(
        root,
        "Library",
        "Application Support",
        "io.github.clash-verge-rev.clash-verge-rev",
        "verge.yaml",
      ),
      "verge_mixed_port: 7899\n",
    );

    assert.equal(
      await __testUtils.resolveUsageProxyForTest(),
      "http://127.0.0.1:7899",
    );
  } finally {
    process.env.HOME = previousEnv.HOME;
    process.env.CODEX_SWITCHER_STATE_DIR = previousEnv.CODEX_SWITCHER_STATE_DIR;
    await rm(root, { recursive: true, force: true });
  }
});

test("electron bridge resolves Windows codex binary candidates without macOS hardcode", () => {
  const codexBin = __testUtils.resolveCodexBinForTest(
    {
      USERPROFILE: "C:\\Users\\tester",
    },
    "win32",
  );

  assert.equal(codexBin, join("C:\\Users\\tester", "AppData", "Local", "Programs", "Codex", "codex.exe"));
});

test("electron bridge honors explicit codex binary override before platform defaults", () => {
  const codexBin = __testUtils.resolveCodexBinForTest(
    {
      CODEX_SWITCHER_CODEX_BIN: "D:\\Tools\\codex-custom.exe",
      USERPROFILE: "C:\\Users\\tester",
    },
    "win32",
  );

  assert.equal(codexBin, "D:\\Tools\\codex-custom.exe");
});

test("electron bridge resolves python launcher for windows without hardcoding python3", () => {
  const pythonBin = __testUtils.resolvePythonCommandForTest(
    {
      USERPROFILE: "C:\\Users\\tester",
    },
    "win32",
  );

  assert.equal(pythonBin, "python");
});

test("electron bridge honors explicit python launcher override", () => {
  const pythonBin = __testUtils.resolvePythonCommandForTest(
    {
      CODEX_SWITCHER_PYTHON_BIN: "py",
      USERPROFILE: "C:\\Users\\tester",
    },
    "win32",
  );

  assert.equal(pythonBin, "py");
});

test("electron bridge preserves raw config content when writing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-config-"));

  try {
    const configPath = join(root, "config.toml");
    const content = "model = \"gpt-5.5\"\n\n[projects.\"/tmp/demo\"]\ntrusted = true\n";

    await __testUtils.writeTextFileRaw(configPath, content);

    assert.equal(await readFile(configPath, "utf8"), content);
    assert.equal(await __testUtils.readTextFileOrEmpty(configPath), content);
    assert.equal(await __testUtils.readTextFileOrEmpty(join(root, "missing.toml")), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
