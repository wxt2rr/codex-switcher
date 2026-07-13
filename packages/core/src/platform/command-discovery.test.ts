import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  codexAppCandidatePaths,
  codexCliCandidatePaths,
  getWindowsReadinessSnapshot,
  resolveCodexAppPath,
  resolveCommandPath,
  resolveWindowsLauncherCommands,
} from "./command-discovery.js";

test("resolveCommandPath finds a PATH executable on unix-like platforms", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-command-discovery-"));
  const binDir = join(root, "bin");
  const cliPath = join(binDir, "codex");

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(cliPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(cliPath, 0o755);

    const result = await resolveCommandPath(
      "codex",
      {
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      },
      "darwin",
    );

    assert.deepEqual(result, {
      source: "env",
      path: cliPath,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codexCliCandidatePaths exposes Windows app install locations", () => {
  assert.deepEqual(
    codexCliCandidatePaths(
      {
        USERPROFILE: "C:\\Users\\alice",
      },
      "win32",
    ),
    [
      join("C:\\Users\\alice", "AppData", "Local", "Programs", "Codex", "codex.exe"),
      join("C:\\Users\\alice", "AppData", "Local", "Programs", "Codex", "resources", "codex.exe"),
    ],
  );
});

test("codexAppCandidatePaths exposes Windows desktop app locations", () => {
  assert.deepEqual(
    codexAppCandidatePaths(
      {
        USERPROFILE: "C:\\Users\\alice",
      },
      "win32",
    ),
    [
      join("C:\\Users\\alice", "AppData", "Local", "Microsoft", "WindowsApps", "ChatGPT.exe"),
      join("C:\\Users\\alice", "AppData", "Local", "Programs", "ChatGPT", "ChatGPT.exe"),
      join("C:\\Users\\alice", "AppData", "Local", "Programs", "Codex", "Codex.exe"),
      join("C:\\Users\\alice", "AppData", "Local", "Programs", "Codex", "CodexApp.exe"),
    ],
  );
});

test("resolveCodexAppPath honors explicit app override", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-app-discovery-"));
  const appPath = join(root, "Codex.exe");

  try {
    await writeFile(appPath, "binary", "utf8");
    await chmod(appPath, 0o755);

    const result = await resolveCodexAppPath(
      {
        CODEX_SWITCHER_APP_BIN: appPath,
      },
      "win32",
    );

    assert.equal(result, appPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codexAppCandidatePaths includes merged ChatGPT Codex bundles on macOS", () => {
  assert.deepEqual(
    codexAppCandidatePaths({ HOME: "/Users/alice" }, "darwin"),
    [
      join("/Users/alice", "Applications", "ChatGPT.app", "Contents", "MacOS", "ChatGPT"),
      join("/Users/alice", "Applications", "Codex.app", "Contents", "MacOS", "Codex"),
      "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      "/Applications/Codex.app/Contents/MacOS/Codex",
    ],
  );
});

test("resolveWindowsLauncherCommands reports launcher executables from PATH on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-launcher-discovery-"));
  const binDir = join(root, "bin");
  const wtPath = join(binDir, "wt.exe");
  const pwshPath = join(binDir, "powershell.exe");

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(wtPath, "binary", "utf8");
    await writeFile(pwshPath, "binary", "utf8");
    await chmod(wtPath, 0o755);
    await chmod(pwshPath, 0o755);

    const result = await resolveWindowsLauncherCommands(
      {
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      },
      "win32",
    );

    assert.deepEqual(result, [
      {
        command: "wt.exe",
        resolved: {
          source: "env",
          path: wtPath,
        },
      },
      {
        command: "powershell.exe",
        resolved: {
          source: "env",
          path: pwshPath,
        },
      },
      {
        command: "cmd.exe",
        resolved: null,
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveCommandPath does not use Codex candidates for unrelated commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-command-discovery-"));
  const codexPath = join(root, "codex");

  try {
    await writeFile(codexPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(codexPath, 0o755);

    const resolved = await resolveCommandPath(
      "wt",
      { PATH: "", CODEX_SWITCHER_CODEX_BIN: codexPath },
      "win32",
    );

    assert.equal(resolved, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("getWindowsReadinessSnapshot aggregates launcher commands, candidates, and shell init files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-windows-readiness-"));
  const binDir = join(root, "bin");
  const wtPath = join(binDir, "wt.exe");

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(wtPath, "binary", "utf8");
    await chmod(wtPath, 0o755);

    const snapshot = await getWindowsReadinessSnapshot(
      {
        USERPROFILE: "C:\\Users\\alice",
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      },
      "win32",
    );

    assert.deepEqual(snapshot.launchers, [
      {
        command: "wt.exe",
        resolved: {
          source: "env",
          path: wtPath,
        },
      },
      {
        command: "powershell.exe",
        resolved: null,
      },
      {
        command: "cmd.exe",
        resolved: null,
      },
    ]);
    assert.deepEqual(snapshot.cliCandidates, codexCliCandidatePaths({ USERPROFILE: "C:\\Users\\alice" }, "win32"));
    assert.deepEqual(snapshot.appCandidates, codexAppCandidatePaths({ USERPROFILE: "C:\\Users\\alice" }, "win32"));
    assert.deepEqual(snapshot.shellInitFiles, [
      join("C:\\Users\\alice", "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
      join("C:\\Users\\alice", "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
