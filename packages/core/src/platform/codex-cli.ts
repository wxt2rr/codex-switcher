import { spawn } from "node:child_process";

import { resolveCommandPath } from "./command-discovery.js";

export interface CodexCliLaunchInput {
  codexHome: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface CodexCliRunnerResult {
  exitCode: number;
}

export type CodexCliRunner = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<CodexCliRunnerResult>;

export async function launchCodexCli(
  input: CodexCliLaunchInput,
  runner: CodexCliRunner = defaultCodexCliRunner,
): Promise<CodexCliRunnerResult> {
  const explicitBin = input.env?.CODEX_SWITCHER_CODEX_BIN;
  const resolved = explicitBin ? { path: explicitBin } : await resolveCommandPath("codex", input.env);
  if (!resolved?.path) {
    throw new Error("codex binary not found. install Codex CLI or set CODEX_SWITCHER_CODEX_BIN");
  }

  return runner(
    resolved.path,
    input.args ?? [],
    {
      ...process.env,
      ...input.env,
      CODEX_HOME: input.codexHome,
    },
  );
}

async function defaultCodexCliRunner(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CodexCliRunnerResult> {
  return new Promise<CodexCliRunnerResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({
        exitCode: code ?? 1,
      });
    });
  });
}
