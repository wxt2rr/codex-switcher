import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BACKUP_FILE = "windows-packaged-app-home-backup.json";

interface HomeSnapshot {
  configToml: string | null;
  authJson: string | null;
}

interface HomeBackup {
  createdAt: string;
  snapshot: HomeSnapshot;
}

export async function prepareWindowsPackagedAppHome(options: {
  stateDir: string;
  defaultHome: string;
  sourceHome: string;
  materialize: (defaultHome: string) => Promise<void>;
}): Promise<void> {
  const backupPath = join(options.stateDir, BACKUP_FILE);
  const currentDefault = await readHomeSnapshot(options.defaultHome);
  let backup = await readBackup(backupPath);
  const createdBackup = !backup;
  if (!backup) {
    backup = { createdAt: new Date().toISOString(), snapshot: currentDefault };
    await writeJsonAtomically(backupPath, backup);
  }

  const restoringDefault = samePath(options.sourceHome, options.defaultHome);
  const source = restoringDefault ? backup.snapshot : await readHomeSnapshot(options.sourceHome);
  try {
    await writeHomeSnapshot(options.defaultHome, source);
    await options.materialize(options.defaultHome);
    if (restoringDefault) await rm(backupPath, { force: true });
  } catch (error) {
    await writeHomeSnapshot(options.defaultHome, currentDefault).catch(() => undefined);
    if (createdBackup) await rm(backupPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function buildWindowsPackagedAppStopCommand(): { command: string; args: string[] } {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$pkgRoot = $null",
    "try { $pkgRoot = (Get-AppxPackage | Where-Object { $_.PackageFamilyName -match '^OpenAI\\.(Codex|ChatGPT)_' } | Select-Object -First 1).InstallLocation } catch {}",
    "if ($pkgRoot) {",
    "  $processes = @(Get-Process -Name ChatGPT,Codex,CodexApp -ErrorAction SilentlyContinue)",
    "  foreach ($process in $processes) {",
    "    $processPath = $null",
    "    try { $processPath = $process.Path } catch {}",
    "    if ($processPath -and $processPath.StartsWith($pkgRoot, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "      try { Stop-Process -Id $process.Id -Force -ErrorAction Stop } catch {}",
    "    }",
    "  }",
    "}",
    "exit 0",
  ].join("\n");
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
  };
}

export async function stopWindowsPackagedAppProcesses(
  runner: (command: string, args: string[]) => Promise<unknown> = (command, args) =>
    execFileAsync(command, args, { timeout: 10_000, windowsHide: true }),
): Promise<boolean> {
  const spec = buildWindowsPackagedAppStopCommand();
  try {
    await runner(spec.command, spec.args);
    return true;
  } catch {
    return false;
  }
}

async function readHomeSnapshot(homePath: string): Promise<HomeSnapshot> {
  return {
    configToml: await readOptional(join(homePath, "config.toml")),
    authJson: await readOptional(join(homePath, "auth.json")),
  };
}

async function writeHomeSnapshot(homePath: string, snapshot: HomeSnapshot): Promise<void> {
  await mkdir(homePath, { recursive: true });
  await writeOptional(join(homePath, "config.toml"), snapshot.configToml);
  await writeOptional(join(homePath, "auth.json"), snapshot.authJson);
}

async function readBackup(path: string): Promise<HomeBackup | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as HomeBackup;
    return value?.snapshot ? value : null;
  } catch {
    return null;
  }
}

async function writeJsonAtomically(path: string, value: HomeBackup): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function writeOptional(path: string, content: string | null): Promise<void> {
  if (content === null) {
    await rm(path, { force: true });
    return;
  }
  await writeFile(path, content, "utf8");
}

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, "").toLowerCase() === right.replace(/[\\/]+$/, "").toLowerCase();
}
